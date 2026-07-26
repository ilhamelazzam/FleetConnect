import { defineConfig, loadEnv } from "vite";
import { existsSync, readFileSync } from "node:fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

function resolveOptionalHttpsFile(rootDir: string, relativeOrAbsolutePath: string, label: string): Buffer {
  const resolvedPath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(rootDir, relativeOrAbsolutePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`${label} introuvable: ${resolvedPath}`);
  }

  return readFileSync(resolvedPath);
}

function resolveDevHttpsOptions(env: Record<string, string>, rootDir: string) {
  const httpsEnabled = env.VITE_DEV_HTTPS?.trim().toLowerCase() === "true";
  if (!httpsEnabled) {
    return undefined;
  }

  const keyPath = env.VITE_DEV_HTTPS_KEY_PATH?.trim();
  const certPath = env.VITE_DEV_HTTPS_CERT_PATH?.trim();
  const caPath = env.VITE_DEV_HTTPS_CA_PATH?.trim();

  if (!keyPath || !certPath) {
    throw new Error(
      "VITE_DEV_HTTPS=true exige VITE_DEV_HTTPS_KEY_PATH et VITE_DEV_HTTPS_CERT_PATH. Utilisez un certificat local (mkcert par exemple) ou placez Vite derriere un proxy HTTPS.",
    );
  }

  return {
    key: resolveOptionalHttpsFile(rootDir, keyPath, "Cle HTTPS Vite"),
    cert: resolveOptionalHttpsFile(rootDir, certPath, "Certificat HTTPS Vite"),
    ...(caPath
      ? {
          ca: resolveOptionalHttpsFile(rootDir, caPath, "Autorite de certification HTTPS Vite"),
        }
      : {}),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const backendTarget = env.VITE_BACKEND_TARGET?.trim() || "http://127.0.0.1:8000";
  const devPort = Number(env.VITE_DEV_PORT || 5173);
  const hmrHost = env.VITE_HMR_HOST?.trim();
  const httpsOptions = resolveDevHttpsOptions(env, __dirname);
  const hmrProtocol = env.VITE_HMR_PROTOCOL?.trim() || (httpsOptions ? "wss" : "ws");

  return {
    plugins: [
      // The React and Tailwind plugins are both required for Make, even if
      // Tailwind is not being actively used - do not remove them.
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      port: devPort,
      strictPort: true,
      https: httpsOptions,
      open: "/login",
      hmr: {
        protocol: hmrProtocol,
        clientPort: devPort,
        overlay: true,
        ...(hmrHost ? { host: hmrHost } : {}),
      },
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
      watch: {
        usePolling: false,
        interval: 100,
        ignored: ["**/.git/**", "**/backend/uploads/**"],
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/test/setup.ts",
    },
    assetsInclude: ["**/*.svg", "**/*.csv"],
  };
});
