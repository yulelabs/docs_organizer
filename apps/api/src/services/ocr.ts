import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

async function ensureTmpDir() {
  await fs.mkdir(config.ocrTmpDir, { recursive: true });
}

export async function extractTextFromImage(imagePath: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "tesseract",
    [imagePath, "stdout", "-l", config.ocrLang, "--psm", "3"],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  return stdout.trim();
}

async function convertPdfToImages(pdfPath: string, outPrefix: string): Promise<string[]> {
  await execFileAsync(
    "pdftoppm",
    ["-png", "-r", "300", pdfPath, outPrefix],
    { maxBuffer: 20 * 1024 * 1024 },
  );

  const dir = path.dirname(outPrefix);
  const base = path.basename(outPrefix);
  const files = await fs.readdir(dir);
  return files
    .filter((name) => name.startsWith(base) && name.endsWith(".png"))
    .sort()
    .map((name) => path.join(dir, name));
}

async function maybePreprocessImage(imagePath: string): Promise<string> {
  // Light contrast/normalize pass helps receipt photos without destroying layout.
  const outPath = imagePath.replace(/(\.[^.]+)$/, ".prep$1");
  try {
    await execFileAsync(
      "convert",
      [
        imagePath,
        "-colorspace",
        "Gray",
        "-normalize",
        "-sharpen",
        "0x1",
        outPath,
      ],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    return outPath;
  } catch {
    return imagePath;
  }
}

export async function ocrFile(input: {
  filePath: string;
  mimeType: string;
  jobId: string;
  onProgress?: (progress: number) => Promise<void> | void;
}): Promise<string> {
  await ensureTmpDir();
  const workDir = path.join(config.ocrTmpDir, input.jobId);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const isPdf =
      input.mimeType === "application/pdf" ||
      input.filePath.toLowerCase().endsWith(".pdf");

    let images: string[] = [];
    if (isPdf) {
      await input.onProgress?.(10);
      images = await convertPdfToImages(input.filePath, path.join(workDir, "page"));
    } else {
      images = [input.filePath];
    }

    if (images.length === 0) {
      throw new Error("No pages/images produced for OCR");
    }

    const texts: string[] = [];
    for (let i = 0; i < images.length; i += 1) {
      const prepared = await maybePreprocessImage(images[i]);
      const pageText = await extractTextFromImage(prepared);
      texts.push(pageText);
      const progress = 20 + Math.round(((i + 1) / images.length) * 70);
      await input.onProgress?.(progress);
    }

    return texts.join("\n\n").trim();
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function assertOcrToolsAvailable(): Promise<{
  tesseract: boolean;
  pdftoppm: boolean;
  convert: boolean;
}> {
  const check = async (bin: string) => {
    try {
      await execFileAsync(bin, ["-v"]);
      return true;
    } catch {
      try {
        await execFileAsync(bin, ["--version"]);
        return true;
      } catch {
        return false;
      }
    }
  };

  return {
    tesseract: await check("tesseract"),
    pdftoppm: await check("pdftoppm"),
    convert: await check("convert"),
  };
}
