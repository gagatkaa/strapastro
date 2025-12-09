const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Check if we're in a Strapi project
function isStrapiProject(projectRoot) {
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Check if @strapi/strapi is in dependencies or devDependencies
    const hasStrapiDependency =
      !!(
        packageJson.dependencies && packageJson.dependencies["@strapi/strapi"]
      ) ||
      !!(
        packageJson.devDependencies &&
        packageJson.devDependencies["@strapi/strapi"]
      );

    // Additionally check for src/index.ts or src/index.js (Strapi entry point)
    const hasSrcIndex =
      fs.existsSync(path.join(projectRoot, "src/index.ts")) ||
      fs.existsSync(path.join(projectRoot, "src/index.js"));

    return hasStrapiDependency && hasSrcIndex;
  } catch (error) {
    return false;
  }
}

// Helper to copy files
function copyFile(projectRoot, sourcePath, destPath, customContent = null) {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    console.warn(
      `⚠️  File already exists, skipping: ${path.relative(
        projectRoot,
        destPath
      )}`
    );
    return false;
  }

  if (customContent) {
    fs.writeFileSync(destPath, customContent);
  } else {
    fs.copyFileSync(sourcePath, destPath);
  }
  console.log(`✅ Created: ${path.relative(projectRoot, destPath)}`);
  return true;
}

// Helper to append to .env
function updateEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const envVars = `
# GitHub Webhook Proxy
GITHUB_PAT=github_pat_{TOKEN}
GITHUB_URL=https://api.github.com/repos/{OWNER}/{REPO}
GITHUB_EVENT_TYPE=strapi_triggers_github_workflow
`;

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    if (!envContent.includes("GITHUB_PAT")) {
      fs.appendFileSync(envPath, envVars);
      console.log("✅ Updated .env with GitHub variables");
    } else {
      console.log("ℹ️  .env already contains GitHub variables");
    }
  } else {
    fs.writeFileSync(envPath, envVars);
    console.log("✅ Created .env with GitHub variables");
  }
}

async function setup(projectRoot, templatesDir) {
  // Check if we're in a Strapi project
  if (!isStrapiProject(projectRoot)) {
    console.error("❌ This doesn't appear to be a Strapi project.");
    console.error(
      "   Please run this command from the root of your Strapi project."
    );
    process.exit(1);
  }

  console.log("🚀 Setting up Strapi Webhook Proxy...");

  const { checkbox } = await import("@inquirer/prompts");

  const selectedEvents = await checkbox({
    message: "Select webhook events to trigger the workflow:",
    choices: [
      { name: "entry.create", value: "entry.create" },
      { name: "entry.update", value: "entry.update" },
      { name: "entry.delete", value: "entry.delete" },
      { name: "entry.publish", value: "entry.publish" },
      { name: "entry.unpublish", value: "entry.unpublish" },
      { name: "media.create", value: "media.create" },
      { name: "media.update", value: "media.update" },
      { name: "media.delete", value: "media.delete" },
    ],
  });

  // 1. Copy Template Files
  const filesToCopy = [
    { src: "config.ts", dest: "src/config.ts" },
    { src: "util/get-github-auth.ts", dest: "src/util/get-github-auth.ts" },
    {
      src: "util/set-up-github-webhook.ts",
      dest: "src/util/set-up-github-webhook.ts",
    },
    {
      src: "util/index.ts",
      dest: "src/util/index.ts",
    },
    {
      src: "api/github/routes/trigger-pipeline.ts",
      dest: "src/api/github/routes/trigger-pipeline.ts",
    },
    {
      src: "api/github/controllers/trigger-pipeline.ts",
      dest: "src/api/github/controllers/trigger-pipeline.ts",
    },
  ];

  for (const file of filesToCopy) {
    let customContent = null;
    if (file.src === "util/set-up-github-webhook.ts") {
      const templatePath = path.join(templatesDir, file.src);
      let content = fs.readFileSync(templatePath, "utf8");
      content = content.replace(
        "events: [],",
        `events: ${JSON.stringify(selectedEvents)},`
      );
      customContent = content;
    }

    copyFile(
      projectRoot,
      path.join(templatesDir, file.src),
      path.join(projectRoot, file.dest),
      customContent
    );
  }

  // 2. Update .env
  updateEnv(projectRoot);

  // 3. Handle Bootstrap (src/index.ts)
  const indexTsPath = path.join(projectRoot, "src/index.ts");

  if (fs.existsSync(indexTsPath)) {
    let indexContent = fs.readFileSync(indexTsPath, "utf8");
    let modified = false;

    // 1. Add Import if missing
    if (!indexContent.includes("import { setUpGithubWebhook }")) {
      indexContent =
        `import { setUpGithubWebhook } from "./util/set-up-github-webhook";\n` +
        indexContent;
      modified = true;
    }

    // 2. Modify Bootstrap
    // Target: bootstrap(/* { strapi }: { strapi: Core.Strapi } */) {}
    const defaultBootstrapRegex = /bootstrap\s*\(\s*\/\*.*?\*\/\s*\)\s*\{\s*\}/;

    if (defaultBootstrapRegex.test(indexContent)) {
      // Replace with uncommented signature and added function call
      indexContent = indexContent.replace(
        defaultBootstrapRegex,
        `async bootstrap({ strapi }: { strapi: Core.Strapi }) {\n    await setUpGithubWebhook(strapi);\n  }`
      );

      // Also ensure Core is imported if it was commented out
      if (indexContent.includes("// import type { Core }")) {
        indexContent = indexContent.replace(
          "// import type { Core }",
          "import type { Core }"
        );
      }

      modified = true;
      console.log(
        "✅ Updated src/index.ts: injected setUpGithubWebhook into bootstrap"
      );
    } else if (indexContent.includes("bootstrap({ strapi }) {}")) {
      // Handle simpler case if user already uncommented but body is empty
      indexContent = indexContent.replace(
        "bootstrap({ strapi }) {}",
        `async bootstrap({ strapi }) {\n    await setUpGithubWebhook(strapi);\n  }`
      );
      modified = true;
      console.log(
        "✅ Updated src/index.ts: injected setUpGithubWebhook into bootstrap"
      );
    } else {
      // If we didn't modify it automatically (maybe it's already complex), warn the user
      if (!indexContent.includes("setUpGithubWebhook")) {
        console.log(
          "\n⚠️  Could not automatically update src/index.ts (pattern not matched)."
        );
        console.log("   Please manually add:");
        console.log(
          `   import { setUpGithubWebhook } from "./util/set-up-github-webhook";`
        );
        console.log(`   // In bootstrap:`);
        console.log(`   await setUpGithubWebhook(strapi);`);
      } else {
        console.log(
          "ℹ️  src/index.ts already seems to contain the webhook setup."
        );
      }
    }

    if (modified) {
      fs.writeFileSync(indexTsPath, indexContent);
    }
  } else {
    // If src/index.ts doesn't exist, we could create it, but Strapi usually has it.
    // We'll just warn.
    console.warn(
      "⚠️  src/index.ts not found. Please ensure you call setUpGithubWebhook in your bootstrap function."
    );
  }

  // 4. Install Dependencies
  console.log("\n📦 Installing dependencies...");
  try {
    execSync("npm install --save-dev @types/koa", { stdio: "inherit" });
    console.log("✅ Installed @types/koa");
  } catch (error) {
    console.error(
      "❌ Failed to install @types/koa. Please run: npm install --save-dev @types/koa"
    );
  }

  console.log(`\n🎉 Setup complete! Don't forget to:
- configure your .env file.
- add this to your GitHub Actions workflow:

  on:
    repository_dispatch:
      types: [strapi_triggers_github_workflow]`);
}

module.exports = { setup, isStrapiProject };
