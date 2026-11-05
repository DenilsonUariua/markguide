"use client";

import { MAX_FILE_BYTES, fileKind, isAcceptedMime } from "@/lib/constants";
import type { UploadedFile } from "@/lib/types";

const MAX_IMAGE_DIMENSION = 1700;
const JPEG_QUALITY = 0.85;

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read that file. Try choosing it again."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Photos straight off a phone camera are 3–8 MB, which blows past the serverless
 * request limit. Downscaling to a legible 1700px JPEG keeps a page of handwriting
 * readable while landing around 200–400 KB.
 */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("no-canvas");

    // Flatten transparency onto white so the page stays readable.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );

    if (!blob) throw new Error("no-blob");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

export class UploadError extends Error {}

/** crypto.randomUUID needs a secure context; fall back when opened over plain http. */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

/** Validates, compresses and base64-encodes a picked file. */
export async function prepareFile(file: File): Promise<UploadedFile> {
  const looksLikeImage = file.type.startsWith("image/");
  const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (!looksLikeImage && !looksLikePdf) {
    throw new UploadError(`${file.name} is not a PDF or an image. Export it as a PDF and try again.`);
  }

  if (!isAcceptedMime(file.type) && !looksLikePdf) {
    // HEIC and friends: browsers can usually still decode them into a canvas.
    if (!looksLikeImage) {
      throw new UploadError(`${file.name} is in a format we can't read. Try a PDF or a JPG.`);
    }
  }

  if (looksLikePdf) {
    if (file.size > MAX_FILE_BYTES) {
      throw new UploadError(
        `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. PDFs need to be under 3 MB — try exporting a compressed copy.`,
      );
    }

    return {
      id: newId(),
      name: file.name,
      mimeType: "application/pdf",
      data: await readAsBase64(file),
      sizeBytes: file.size,
      kind: "pdf",
    };
  }

  let blob: Blob = file;
  try {
    blob = await compressImage(file);
  } catch {
    // Fall back to the original only when it is already small enough to send.
    if (file.size > MAX_FILE_BYTES) {
      throw new UploadError(`${file.name} could not be resized. Try a PDF or a smaller photo.`);
    }
    if (!isAcceptedMime(file.type)) {
      throw new UploadError(
        `${file.name} is in a format we can't send. Take a screenshot of it, or export it as a PDF.`,
      );
    }
  }

  if (blob.size > MAX_FILE_BYTES) {
    throw new UploadError(`${file.name} is still too large after resizing. Try a different photo.`);
  }

  return {
    id: newId(),
    name: file.name,
    mimeType: blob.type || "image/jpeg",
    data: await readAsBase64(blob),
    sizeBytes: blob.size,
    kind: fileKind(blob.type || "image/jpeg"),
    previewUrl: URL.createObjectURL(blob),
  };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("You appear to be offline. Check your connection and try again.");
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string; detail?: string })
    | null;

  if (!response.ok || !payload) {
    throw new Error(
      payload?.error ||
        (response.status === 413
          ? "That file is too large to send. Keep each document under 3 MB."
          : "The server could not complete that request. Please try again."),
    );
  }

  return payload;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const escape = (value: string) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  // The BOM keeps Excel happy with non-ASCII names.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
