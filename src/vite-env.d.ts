/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TESSERACT_CORE_PATH?: string;
  readonly VITE_TESSERACT_LANG_PATH?: string;
  readonly VITE_TESSERACT_LANGUAGE?: string;
  readonly VITE_TESSERACT_WORKER_PATH?: string;
}
