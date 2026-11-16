import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../contracts/avatar-service.openapi.yaml",
  output: "src/avatar",
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk", "zod"],
});
