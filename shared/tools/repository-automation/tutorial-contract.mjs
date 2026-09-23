// Validates tutorial source metadata and assets before publication.

import { lstat, readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { fromMarkdown } from "mdast-util-from-markdown";
import sharp from "sharp";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const tutorialLimits = Object.freeze({
  assetBytes: 2 * 1024 * 1024,
  assetPixels: 25_000_000,
  assetTotalBytes: 10 * 1024 * 1024,
  assets: 32,
  bundleBytes: 12 * 1024 * 1024,
  bundleEntries: 40,
  markdownBytes: 1024 * 1024,
});

const imageExtensions = new Set([
  ".avif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const metadataSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    order: z.number().int().nonnegative(),
    lastVerified: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => Date.parse(value) <= Date.now(),
        "must not be in the future",
      ),
  })
  .strict();
const safeAssetPathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const bundleBaseEntries = 2;
const mebibyte = 1024 * 1024;
const dom = new JSDOM("");
const purifier = createDOMPurify(dom.window);

function fail(message) {
  throw new Error(message);
}

function toPosix(path) {
  return path.split(sep).join("/");
}

function mebibytes(bytes) {
  return `${bytes / mebibyte} MiB`;
}

async function regularFile(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    fail(`${label} is missing: ${path}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    fail(`${label} must be a regular file: ${path}`);
  }
  return stats;
}

function walkMarkdown(node, visit) {
  visit(node);
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) walkMarkdown(child, visit);
  }
}

function parseTutorial(markdown, sourcePath) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
  if (!match) fail(`${sourcePath}: expected a YAML frontmatter block`);

  let frontmatter;
  try {
    frontmatter = parseYaml(match[1]);
  } catch (error) {
    fail(
      `${sourcePath}: invalid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const parsed = metadataSchema.safeParse(frontmatter);
  if (!parsed.success) {
    fail(
      `${sourcePath}: ${parsed.error.issues
        .map(
          (issue) =>
            `${issue.path.join(".") || "frontmatter"}: ${issue.message}`,
        )
        .join("; ")}`,
    );
  }

  const body = match[2];
  const tree = fromMarkdown(body);
  const headings = [];
  walkMarkdown(tree, (node) => {
    if (node.type === "heading" && node.depth === 1) headings.push(node);
  });
  const heading = headings[0];
  if (
    headings.length !== 1 ||
    tree.children[0] !== heading ||
    heading.children.length !== 1 ||
    heading.children[0].type !== "text" ||
    heading.children[0].value.trim() !== parsed.data.title
  ) {
    fail(`${sourcePath}: the body must start with one H1 that matches title`);
  }
  return tree;
}

function referencedAssets(tree, sourcePath) {
  const references = new Set();
  walkMarkdown(tree, (node) => {
    if (node.type === "imageReference") {
      fail(`${sourcePath}: image references must use inline relative paths`);
    }
    if (node.type !== "image") return;
    const alt = (node.alt ?? "").trim();
    const target = node.url.trim();
    if (alt.length === 0) fail(`${sourcePath}: every image requires alt text`);
    if (
      !target.startsWith("./assets/") ||
      target.includes("\\") ||
      target.includes("%") ||
      target.includes("?") ||
      target.includes("#")
    ) {
      fail(`${sourcePath}: unsafe tutorial image path ${target}`);
    }
    const asset = target.slice("./assets/".length);
    if (
      !safeAssetPathPattern.test(asset) ||
      asset.split("/").some((component) => component === "..") ||
      posix.normalize(asset) !== asset ||
      !imageExtensions.has(posix.extname(asset).toLowerCase())
    ) {
      fail(`${sourcePath}: unsupported or unsafe tutorial image ${target}`);
    }
    references.add(asset);
  });
  return references;
}

async function walkFiles(directory, root = directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`symbolic links are not allowed: ${path}`);
    if (entry.isDirectory()) files.push(...(await walkFiles(path, root)));
    else if (entry.isFile()) files.push(toPosix(relative(root, path)));
    else fail(`unsupported filesystem entry: ${path}`);
  }
  return files;
}

async function validateImage(bytes, extension, path) {
  if (extension === ".svg") {
    validateSvg(bytes, path);
    return;
  }

  const expectedFormat =
    extension === ".avif"
      ? "heif"
      : extension === ".jpg" || extension === ".jpeg"
        ? "jpeg"
        : extension.slice(1);
  try {
    const image = sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: tutorialLimits.assetPixels,
      pages: 1,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      metadata.format !== expectedFormat ||
      (extension === ".avif" && metadata.compression !== "av1")
    ) {
      throw new Error(`detected ${metadata.format ?? "unknown"}`);
    }
    await image.clone().raw().toBuffer();
  } catch {
    fail(
      `${path}: image is corrupt, exceeds ${tutorialLimits.assetPixels} pixels, or does not match its extension`,
    );
  }
}

function validateSvg(bytes, path) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${path}: SVG must be valid UTF-8`);
  }
  if (
    /<!DOCTYPE|<!ENTITY/i.test(source) ||
    /<(?:script|foreignObject|iframe|object|embed|style)\b/i.test(source) ||
    /\son[a-z]+\s*=/i.test(source)
  ) {
    fail(`${path}: SVG contains active or external content`);
  }

  const parseSvg = (value) => {
    const document = new dom.window.DOMParser().parseFromString(
      value,
      "image/svg+xml",
    );
    if (
      document.documentElement.localName !== "svg" ||
      document.querySelector("parsererror")
    ) {
      fail(`${path}: SVG must be valid XML`);
    }
    return document;
  };
  const document = parseSvg(source);
  const sanitized = purifier.sanitize(source, {
    ALLOW_ARIA_ATTR: true,
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"],
    FORBID_TAGS: ["foreignObject", "script", "style"],
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  const sanitizedDocument = parseSvg(sanitized);
  if (
    document.documentElement.outerHTML !==
    sanitizedDocument.documentElement.outerHTML
  ) {
    fail(`${path}: SVG contains unsupported content`);
  }

  for (const element of document.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name === "style" || name.startsWith("on")) {
        fail(`${path}: SVG contains active or external content`);
      }
      if (
        (name === "href" || name === "xlink:href") &&
        !value.startsWith("#")
      ) {
        fail(`${path}: SVG contains active or external content`);
      }
      for (const reference of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
        if (!reference[2]?.trim().startsWith("#")) {
          fail(`${path}: SVG contains active or external content`);
        }
      }
    }
  }
}

export async function validateTutorialProject(
  repositoryRoot,
  project,
  tutorialProjects,
) {
  if (!tutorialProjects.includes(project)) {
    fail(`unknown tutorial project: ${project}`);
  }
  const docsRoot = join(repositoryRoot, project, "docs");
  const tutorialPath = join(docsRoot, "tutorials.md");
  const tutorialStats = await regularFile(tutorialPath, "tutorial source");
  if (tutorialStats.size > tutorialLimits.markdownBytes) {
    fail(`${tutorialPath}: exceeds ${mebibytes(tutorialLimits.markdownBytes)}`);
  }
  const markdown = await readFile(tutorialPath, "utf8");
  const sourcePath = `${project}/docs/tutorials.md`;
  const tree = parseTutorial(markdown, sourcePath);
  const references = referencedAssets(tree, sourcePath);
  const assetRoot = join(docsRoot, "assets");
  const assets = await walkFiles(assetRoot);
  if (assets.length > tutorialLimits.assets) {
    fail(
      `${project}: tutorial contains more than ${tutorialLimits.assets} asset files`,
    );
  }

  let assetBytes = 0;
  for (const asset of assets) {
    const path = join(assetRoot, ...asset.split("/"));
    const stats = await regularFile(path, "tutorial asset");
    if (!references.has(asset)) {
      fail(`${project}/docs/assets/${asset}: asset is not referenced`);
    }
    if (stats.size > tutorialLimits.assetBytes) {
      fail(
        `${project}/docs/assets/${asset}: exceeds ${mebibytes(tutorialLimits.assetBytes)}`,
      );
    }
    assetBytes += stats.size;
    await validateImage(
      await readFile(path),
      posix.extname(asset).toLowerCase(),
      `${project}/docs/assets/${asset}`,
    );
  }
  for (const reference of references) {
    if (!assets.includes(reference)) {
      fail(`${sourcePath}: missing asset ./assets/${reference}`);
    }
  }
  if (bundleBaseEntries + assets.length > tutorialLimits.bundleEntries) {
    fail(
      `${project}: tutorial bundle exceeds ${tutorialLimits.bundleEntries} files`,
    );
  }
  if (assetBytes > tutorialLimits.assetTotalBytes) {
    fail(
      `${project}: tutorial assets exceed ${mebibytes(tutorialLimits.assetTotalBytes)}`,
    );
  }
  if (tutorialStats.size + assetBytes > tutorialLimits.bundleBytes) {
    fail(
      `${project}: tutorial bundle exceeds ${mebibytes(tutorialLimits.bundleBytes)} expanded`,
    );
  }
  return { assets, markdown };
}
