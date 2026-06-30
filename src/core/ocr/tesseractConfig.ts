export interface TesseractWorkerConfig {
  language: string;
  workerPath?: string;
  corePath?: string;
  langPath?: string;
}

export interface TesseractConfigEnv {
  VITE_TESSERACT_LANGUAGE?: string;
  VITE_TESSERACT_WORKER_PATH?: string;
  VITE_TESSERACT_CORE_PATH?: string;
  VITE_TESSERACT_LANG_PATH?: string;
}

const ABSOLUTE_PATH_PATTERN = /^(?:[a-z][a-z\d+\-.]*:|\/\/)/i;
export const DEFAULT_TESSERACT_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveTesseractAssetPath(value: string | undefined, baseUrl: string) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (ABSOLUTE_PATH_PATTERN.test(trimmed) || trimmed.startsWith("/")) {
    return trimTrailingSlash(trimmed);
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return trimTrailingSlash(`${normalizedBaseUrl}${trimmed}`);
}

export function createTesseractWorkerConfig(
  env: TesseractConfigEnv,
  baseUrl: string,
): TesseractWorkerConfig {
  const configuredLangPath = resolveTesseractAssetPath(env.VITE_TESSERACT_LANG_PATH, baseUrl);

  return {
    language: env.VITE_TESSERACT_LANGUAGE?.trim() || "jpn",
    workerPath: resolveTesseractAssetPath(env.VITE_TESSERACT_WORKER_PATH, baseUrl),
    corePath: resolveTesseractAssetPath(env.VITE_TESSERACT_CORE_PATH, baseUrl),
    langPath: configuredLangPath ?? DEFAULT_TESSERACT_LANG_PATH,
  };
}
