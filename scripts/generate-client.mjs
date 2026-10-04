import fs from "fs";
import path from "path";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { visit } from "codama";

const idlPath = path.resolve("./anchor/target/idl/vault.json");
const outputDir = path.resolve("./app/generated/vault");

console.log("Reading IDL from:", idlPath);
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

console.log("Transforming Anchor IDL into Codama AST...");
const rootNode = rootNodeFromAnchor(idl);

console.log("Rendering TypeScript client into:", outputDir);
visit(rootNode, renderVisitor(outputDir));

console.log("Codama client generation completed successfully!");
