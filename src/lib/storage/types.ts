/** 업로드 데이터 영속 저장소 추상화 (Vercel Blob / GCS 공통 인터페이스) */

export interface StoredObjectMeta {
  /** 저장 키 (예: excel-data/{fileId}.json) */
  key: string;
  /** 업로드 시각 (epoch ms) */
  uploadedAt: number;
}

export interface UploadBlobStore {
  /** 영속 저장소가 구성되어 있는지 (false면 인메모리만 사용) */
  readonly enabled: boolean;
  /** 제공자 이름 (로그·진단용) */
  readonly provider: "gcs" | "vercel-blob" | "none";
  put(key: string, body: string): Promise<void>;
  head(key: string): Promise<boolean>;
  get(key: string): Promise<string | undefined>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<StoredObjectMeta[]>;
}

export const NOOP_BLOB_STORE: UploadBlobStore = {
  enabled: false,
  provider: "none",
  async put() {},
  async head() {
    return false;
  },
  async get() {
    return undefined;
  },
  async delete() {},
  async list() {
    return [];
  },
};
