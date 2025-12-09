#!/usr/bin/env node

const path = require("path");
const { setup } = require("../lib/setup");

const projectRoot = process.cwd();
const templatesDir = path.join(__dirname, "../templates");

setup(projectRoot, templatesDir).catch(console.error);
