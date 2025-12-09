import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import { setup, isStrapiProject } from "../lib/setup";

// Mock @inquirer/prompts
vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn().mockResolvedValue(["entry.publish", "entry.unpublish"]),
}));

// Mock child_process to avoid running npm install
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

describe("isStrapiProject", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strapi-check-"));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should return false when package.json doesn't exist", () => {
    expect(isStrapiProject(tempDir)).toBe(false);
  });

  it("should return false when @strapi/strapi is not in dependencies", () => {
    const packageJson = {
      name: "test-project",
      dependencies: {},
    };
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(packageJson)
    );
    expect(isStrapiProject(tempDir)).toBe(false);
  });

  it("should return false when src/index.ts doesn't exist", () => {
    const packageJson = {
      name: "test-project",
      dependencies: {
        "@strapi/strapi": "^5.0.0",
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(packageJson)
    );
    expect(isStrapiProject(tempDir)).toBe(false);
  });

  it("should return true when both @strapi/strapi and src/index.ts exist", () => {
    const packageJson = {
      name: "test-project",
      dependencies: {
        "@strapi/strapi": "^5.0.0",
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(packageJson)
    );
    fs.mkdirSync(path.join(tempDir, "src"));
    fs.writeFileSync(path.join(tempDir, "src/index.ts"), "");
    expect(isStrapiProject(tempDir)).toBe(true);
  });
});

describe("setup", () => {
  let tempDir;
  const templatesDir = path.join(__dirname, "../templates");

  beforeAll(() => {
    // Create a temporary directory for the test project
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strapi-test-"));
    console.log(`Testing in temp dir: ${tempDir}`);

    // Create package.json with @strapi/strapi dependency
    const packageJson = {
      name: "test-strapi-project",
      dependencies: {
        "@strapi/strapi": "^5.0.0",
      },
    };
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(packageJson)
    );

    // Create a dummy src/index.ts to simulate a Strapi project
    const srcDir = path.join(tempDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const initialIndexTs = `
import type { Core } from '@strapi/strapi';

export default {
  register({ strapi }: { strapi: Core.Strapi }) {},
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {},
};
`;
    fs.writeFileSync(path.join(srcDir, "index.ts"), initialIndexTs);
  });

  afterAll(() => {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create necessary files and update index.ts", async () => {
    await setup(tempDir, templatesDir);

    // Check if files are created
    expect(fs.existsSync(path.join(tempDir, "src/config.ts"))).toBe(true);
    expect(
      fs.existsSync(path.join(tempDir, "src/util/get-github-auth.ts"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(tempDir, "src/util/set-up-github-webhook.ts"))
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tempDir, "src/api/github/routes/trigger-pipeline.ts")
      )
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tempDir, "src/api/github/controllers/trigger-pipeline.ts")
      )
    ).toBe(true);
    expect(fs.existsSync(path.join(tempDir, ".env"))).toBe(true);

    // Check if set-up-github-webhook.ts contains selected events
    const webhookFile = fs.readFileSync(
      path.join(tempDir, "src/util/set-up-github-webhook.ts"),
      "utf8"
    );
    expect(webhookFile).toContain(
      'events: ["entry.publish","entry.unpublish"]'
    );

    // Check if src/index.ts is updated
    const indexTs = fs.readFileSync(path.join(tempDir, "src/index.ts"), "utf8");
    expect(indexTs).toContain(
      'import { setUpGithubWebhook } from "./util/set-up-github-webhook";'
    );
    expect(indexTs).toContain(
      "async bootstrap({ strapi }: { strapi: Core.Strapi }) {"
    );
    expect(indexTs).toContain("await setUpGithubWebhook(strapi);");
  });
});
