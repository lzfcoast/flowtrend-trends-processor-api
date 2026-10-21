import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const processorPath = path.join(projectRoot, "automation", "processor.py");
export const editorialExportDirectory = path.join(
  projectRoot,
  "public",
  "exports"
);
export const editorialExportPath = path.join(
  editorialExportDirectory,
  "flowtrend-blogger-export.xml"
);

function pythonExecutable() {
  return (
    process.env.PYTHON_BIN ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

export function automationTokenIsValid(value?: string) {
  const expected = process.env.FLOWTREND_AUTOMATION_TOKEN;
  if (!expected || !value) return false;
  return value === expected;
}

export function requestPayload(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") return JSON.stringify(body);
  return "";
}

export function runEditorialProcessor(
  payload: string,
  format: "json" | "xml"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutable(),
      [processorPath, "--format", format],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(stderr.trim() || `Python processor exited with ${code}`)
        );
    });
    child.stdin.end(payload);
  });
}

export async function saveEditorialExport(xml: string) {
  await mkdir(editorialExportDirectory, { recursive: true });
  const temporaryPath = `${editorialExportPath}.tmp`;
  await writeFile(temporaryPath, xml, "utf8");
  await rename(temporaryPath, editorialExportPath);
  return editorialExportPath;
}

export async function readEditorialExport() {
  return readFile(editorialExportPath, "utf8");
}

export async function ensureEditorialExportStorage() {
  await mkdir(editorialExportDirectory, { recursive: true });
}
