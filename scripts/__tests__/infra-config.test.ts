/**
 * Infrastructure configuration validation tests.
 *
 * Validates that the nginx config, docker-compose.prod.yml, and
 * init-letsencrypt.sh script are well-formed and contain the
 * required directives for HTTPS termination with Let's Encrypt.
 * These tests catch configuration drift and missing directives
 * before deployment.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

describe("nginx configuration", () => {
  const nginxConf = fs.readFileSync(
    path.join(ROOT, "nginx/nginx.conf"),
    "utf-8"
  );

  it("defines the upstream app block pointing to app:3000", () => {
    expect(nginxConf).toMatch(/upstream\s+app\s*\{/);
    expect(nginxConf).toMatch(/server\s+app:3000/);
  });

  it("listens on port 80 for HTTP with ACME challenge support", () => {
    expect(nginxConf).toMatch(/listen\s+80/);
    expect(nginxConf).toMatch(/\.well-known\/acme-challenge/);
  });

  it("redirects HTTP to HTTPS", () => {
    expect(nginxConf).toMatch(/return\s+301\s+https/);
  });

  it("listens on port 443 with SSL", () => {
    expect(nginxConf).toMatch(/listen\s+443\s+ssl/);
  });

  it("uses ${DOMAIN} template variable for server_name and certificate paths", () => {
    // The nginx Docker image's envsubst replaces ${DOMAIN} at startup
    expect(nginxConf).toMatch(/server_name\s+\$\{DOMAIN\}/);
    expect(nginxConf).toContain(
      "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    );
    expect(nginxConf).toContain(
      "/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
    );
  });

  it("configures modern TLS (1.2+ only, no deprecated protocols)", () => {
    expect(nginxConf).toMatch(/ssl_protocols\s+TLSv1\.2\s+TLSv1\.3/);
    // Must NOT allow TLS 1.0 or 1.1
    expect(nginxConf).not.toMatch(/TLSv1\.0/);
    expect(nginxConf).not.toMatch(/TLSv1\.1/);
  });

  it("sets security headers (HSTS, X-Frame-Options, X-Content-Type-Options)", () => {
    expect(nginxConf).toContain("Strict-Transport-Security");
    expect(nginxConf).toContain("X-Frame-Options");
    expect(nginxConf).toContain("X-Content-Type-Options");
  });

  it("proxies to the upstream app with required forwarding headers", () => {
    expect(nginxConf).toContain("proxy_pass http://app");
    expect(nginxConf).toContain("X-Real-IP");
    expect(nginxConf).toContain("X-Forwarded-For");
    expect(nginxConf).toContain("X-Forwarded-Proto");
  });

  it("enables OCSP stapling for certificate validation", () => {
    expect(nginxConf).toMatch(/ssl_stapling\s+on/);
    expect(nginxConf).toMatch(/ssl_stapling_verify\s+on/);
  });

  it("enables HTTP/2 on the HTTPS server", () => {
    expect(nginxConf).toMatch(/http2\s+on/);
  });

  it("supports WebSocket upgrade for Next.js hot reloading", () => {
    expect(nginxConf).toContain("Upgrade");
    expect(nginxConf).toMatch(/proxy_set_header\s+Connection\s+"upgrade"/);
  });
});

describe("docker-compose.prod.yml", () => {
  const compose = fs.readFileSync(
    path.join(ROOT, "docker-compose.prod.yml"),
    "utf-8"
  );

  it("defines all six required services", () => {
    // Each service must appear as a top-level key under 'services:'
    for (const service of [
      "postgres:",
      "migrate:",
      "app:",
      "worker:",
      "nginx:",
      "certbot:",
    ]) {
      expect(compose).toContain(service);
    }
  });

  it("nginx service exposes ports 80 and 443", () => {
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
  });

  it("nginx mounts the config template into /etc/nginx/templates/", () => {
    expect(compose).toMatch(
      /nginx\/nginx\.conf:\/etc\/nginx\/templates\/default\.conf\.template/
    );
  });

  it("nginx mounts Let's Encrypt certificate directory (read-only)", () => {
    expect(compose).toMatch(
      /certbot\/conf:\/etc\/letsencrypt:ro/
    );
  });

  it("nginx mounts ACME webroot directory (read-only)", () => {
    expect(compose).toMatch(
      /certbot\/www:\/var\/www\/certbot:ro/
    );
  });

  it("nginx depends on app being healthy", () => {
    // The nginx section should contain a dependency on app with service_healthy
    const nginxSection = compose.split(/^\s{2}\w+:/m).find((s) =>
      s.includes("nginx:1.27-alpine")
    );
    expect(nginxSection).toBeDefined();
    expect(nginxSection).toContain("service_healthy");
  });

  it("certbot mounts certificate and webroot volumes with write access", () => {
    // Certbot volumes should NOT have :ro suffix
    const certbotSection = compose.split(/^\s{2}\w+:/m).find((s) =>
      s.includes("certbot/certbot")
    );
    expect(certbotSection).toBeDefined();
    expect(certbotSection).toContain("./certbot/conf:/etc/letsencrypt");
    expect(certbotSection).toContain("./certbot/www:/var/www/certbot");
    // Verify no :ro on certbot's volumes
    expect(certbotSection).not.toMatch(/certbot\/conf:\/etc\/letsencrypt:ro/);
    expect(certbotSection).not.toMatch(/certbot\/www:\/var\/www\/certbot:ro/);
  });

  it("app uses expose (internal) instead of ports (external)", () => {
    // The app section should have 'expose' not 'ports' since nginx
    // handles external traffic
    const appSection = compose.split(/^\s{2}\w+:/m).find((s) =>
      s.includes("target: app")
    );
    expect(appSection).toBeDefined();
    expect(appSection).toContain("expose:");
    expect(appSection).not.toMatch(/^\s{4}ports:/m);
  });

  it("requires DOMAIN environment variable for nginx", () => {
    expect(compose).toMatch(/DOMAIN.*:.*\?/);
  });

  it("nginx reloads periodically for certificate renewal", () => {
    // The command should include a reload loop
    expect(compose).toContain("nginx -s reload");
  });

  it("certbot runs renewal checks periodically", () => {
    expect(compose).toContain("certbot renew");
  });

  describe("CloudWatch logging", () => {
    // Validates that all services use the awslogs Docker logging driver
    // to send container logs to AWS CloudWatch Logs for centralized
    // monitoring on the pilot EC2 deployment.

    const services = ["postgres", "migrate", "app", "worker", "nginx", "certbot"];

    it("configures the awslogs logging driver on all services", () => {
      for (const service of services) {
        expect(compose).toContain(`awslogs-group: /copi/${service}`);
      }
    });

    it("uses a dedicated /copi/<service> log group per service for isolation", () => {
      // Each service gets its own log group so operators can tail individual
      // services independently (e.g., `aws logs tail /copi/worker --follow`)
      for (const service of services) {
        const groupPattern = new RegExp(
          `awslogs-group:\\s*/copi/${service}`
        );
        expect(compose).toMatch(groupPattern);
      }
    });

    it("sets awslogs-stream-prefix on all services for readable stream names", () => {
      for (const service of services) {
        expect(compose).toContain(`awslogs-stream-prefix: ${service}`);
      }
    });

    it("enables auto-creation of log groups on all services", () => {
      // awslogs-create-group: "true" means the Docker daemon auto-creates
      // the log group if it doesn't exist, avoiding manual setup
      const createGroupCount = (compose.match(/awslogs-create-group:\s*"true"/g) || []).length;
      expect(createGroupCount).toBe(services.length);
    });

    it("uses AWS_REGION variable with us-east-1 default", () => {
      // All services should reference ${AWS_REGION:-us-east-1}
      const regionRefCount = (compose.match(/awslogs-region:\s*\$\{AWS_REGION:-us-east-1\}/g) || []).length;
      expect(regionRefCount).toBe(services.length);
    });

    it("documents IAM permissions required for CloudWatch logging", () => {
      // The compose file header should document the required IAM permissions
      expect(compose).toContain("logs:CreateLogGroup");
      expect(compose).toContain("logs:CreateLogStream");
      expect(compose).toContain("logs:PutLogEvents");
    });
  });
});

describe("init-letsencrypt.sh", () => {
  const script = fs.readFileSync(
    path.join(ROOT, "scripts/init-letsencrypt.sh"),
    "utf-8"
  );

  it("starts with a bash shebang", () => {
    expect(script.startsWith("#!/bin/bash")).toBe(true);
  });

  it("uses strict mode (set -euo pipefail) for safe error handling", () => {
    expect(script).toContain("set -euo pipefail");
  });

  it("validates DOMAIN and CERTBOT_EMAIL variables are set", () => {
    // Script should check for required variables and exit if missing
    expect(script).toMatch(/DOMAIN.*not set/i);
    expect(script).toMatch(/CERTBOT_EMAIL.*not set/i);
  });

  it("supports Let's Encrypt staging mode via CERTBOT_STAGING env var", () => {
    expect(script).toContain("CERTBOT_STAGING");
    expect(script).toContain("--staging");
  });

  it("creates a temporary self-signed cert so nginx can start on port 443", () => {
    expect(script).toContain("openssl req -x509");
  });

  it("requests a real certificate via certbot webroot mode", () => {
    expect(script).toContain("certbot certonly");
    expect(script).toContain("--webroot");
    expect(script).toContain("--agree-tos");
  });

  it("reloads nginx after obtaining the real certificate", () => {
    expect(script).toContain("nginx -s reload");
  });

  it("is executable", () => {
    const stats = fs.statSync(path.join(ROOT, "scripts/init-letsencrypt.sh"));
    const isExecutable = (stats.mode & 0o111) !== 0;
    expect(isExecutable).toBe(true);
  });

  it("checks for existing certificates to avoid accidental overwrite", () => {
    expect(script).toContain("Existing certificate found");
  });
});

describe(".env.example", () => {
  const envExample = fs.readFileSync(
    path.join(ROOT, ".env.example"),
    "utf-8"
  );

  it("documents DOMAIN variable for production deployment", () => {
    expect(envExample).toContain("DOMAIN=");
  });

  it("documents CERTBOT_EMAIL variable for certificate management", () => {
    expect(envExample).toContain("CERTBOT_EMAIL=");
  });

  it("documents POSTGRES_PASSWORD variable for production database", () => {
    expect(envExample).toContain("POSTGRES_PASSWORD=");
  });

  it("documents CERTBOT_STAGING variable for testing against staging CA", () => {
    expect(envExample).toContain("CERTBOT_STAGING=");
  });

  it("documents AWS_REGION usage for CloudWatch logging", () => {
    // AWS_REGION is used by both the application (SES) and the awslogs
    // Docker logging driver — the .env.example should mention both
    expect(envExample).toContain("AWS_REGION=");
    expect(envExample).toMatch(/CloudWatch|awslogs/i);
  });
});
