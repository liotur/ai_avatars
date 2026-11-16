import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../contracts/assistant.openapi.yaml",
  output: "src/assistant",
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk", "zod"],
});
