# Cloud Run 배포 매뉴얼 (excel-ai-chat)

코드를 수정한 뒤 Cloud Run에 반영하는 절차입니다.  
**Vercel의 `git push` → 자동 배포**에 해당하는 작업이 아래 **2단계(빌드 → 배포)** 입니다.

---

## 언제 다시 배포하나?

| 변경 종류 | 필요 작업 |
|-----------|-----------|
| `src/` 등 **앱 코드** 수정 | **빌드 + 배포** (둘 다) |
| `NEXT_PUBLIC_*` (BOX URL, basePath 등) | **빌드 + 배포** (빌드 시 박힘) |
| `GEMINI_MODEL`, `RAG_*`, `UPLOAD_MAX_BYTES` 등 **런타임 env**만 | **배포만** (`--set-env-vars` 변경) |
| Secret Manager 값만 변경 | **배포만** (또는 콘솔에서 리비전 재배포) |

---

## 사전 준비 (최초 1회만)

- GCP 프로젝트: `digitalds-6ef38`
- 리전: `asia-northeast3` (서울)
- 서비스명: `excel-ai-chat`
- 이미지: `asia-northeast3-docker.pkg.dev/digitalds-6ef38/excel-ai-chat/excel-ai-chat:latest`
- 공식 URL (임시): `https://excel-ai-chat-364392170079.asia-northeast3.run.app/chat`
- GCS 버킷: `seesign-chat-uploads-prod`

터미널에서 프로젝트 확인:

```powershell
gcloud config set project digitalds-6ef38
```

`gcloud` 명령이 안 되면 **새 PowerShell**을 열거나 PATH에 Google Cloud SDK가 있는지 확인합니다.

---

## 매번 배포 절차 (코드 수정 후)

프로젝트 루트(`c:\excel-ai-chat`)에서 실행합니다.

### STEP 1 — Docker 이미지 빌드 & 푸시

> PowerShell에서는 `--substitutions` **전체를 큰따옴표로** 감싸야 합니다. (쉼표 때문에 필수)

```powershell
gcloud builds submit --config cloudbuild.yaml --substitutions="_REGION=asia-northeast3,_REPO=excel-ai-chat,_SERVICE=excel-ai-chat,_TAG=latest,_NEXT_PUBLIC_BASE_PATH=/chat,_NEXT_PUBLIC_AIBLE_BOX_URL=https://aible-box.vercel.app,_NEXT_PUBLIC_SEESIGN_ADMIN_URL=https://seesign-admin.digitalds.store/main,_NEXT_PUBLIC_CHAT_GUIDE_URL=https://seesign.mintlify.app/guide/chat/ready"
```

- 끝에 **`SUCCESS`** 가 나올 때까지 대기 (수 분).
- 실패 시 [Cloud Build 로그](https://console.cloud.google.com/cloud-build/builds?project=364392170079) 확인.

#### 빌드 시 박히는 값 (`NEXT_PUBLIC_*`)

| 변수 | 현재 값 | 설명 |
|------|---------|------|
| `_NEXT_PUBLIC_BASE_PATH` | `/chat` | 앱이 `/chat` 하위에서 동작 |
| `_NEXT_PUBLIC_AIBLE_BOX_URL` | `https://aible-box.vercel.app` | 헤더 **← AiBle BOX** 링크 |
| `_NEXT_PUBLIC_SEESIGN_ADMIN_URL` | `https://seesign-admin.digitalds.store/main` | SEE:SIGN Admin CTA |
| `_NEXT_PUBLIC_CHAT_GUIDE_URL` | `https://seesign.mintlify.app/guide/chat/ready` | 가이드 버튼 |

이 값들을 바꾸려면 **위 명령의 substitutions만 수정** 후 다시 빌드합니다.

---

### STEP 2 — Cloud Run 배포

빌드 성공 후 **같은 터미널**에서:

```powershell
gcloud run deploy excel-ai-chat --image asia-northeast3-docker.pkg.dev/digitalds-6ef38/excel-ai-chat/excel-ai-chat:latest --region asia-northeast3 --allow-unauthenticated --memory 4Gi --cpu 2 --timeout 900 --concurrency 20 --set-env-vars "GEMINI_MODEL=gemini-3.5-flash,GEMINI_EMBEDDING_MODEL=gemini-embedding-001,RAG_TOP_K=24,RAG_EMBED_BATCH_SIZE=100,RAG_EMBED_CONCURRENCY=8,RAG_ROWS_PER_CHUNK=25,RAG_EMBEDDING_DIMENSIONS=768,RAG_INDEX_QA=true,RAG_MAX_QA_INDEX_ROWS=5000,GEMINI_MAX_DIGEST_BODY_CHARS=3000,GEMINI_MAX_LOCATION_DIGEST_CHARS=80000,LECTURE_HOTSPOT_SEGMENT_MINUTES=10,LECTURE_TIME_TOLERANCE_MINUTES=5,COMMUNITY_MAP_CHARS_PER_ROW=280,UPLOAD_MAX_BYTES=31457280,CHAT_MAX_REQUEST_BYTES=25000000,BLOB_TTL_HOURS=24,GCS_UPLOAD_BUCKET=seesign-chat-uploads-prod" --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,CRON_SECRET=CRON_SECRET:latest"
```

- 끝에 **Service URL** 이 출력됩니다.
- 시크릿 권한 오류가 나면 아래 [트러블슈팅](#트러블슈팅) 참고.

---

### STEP 3 — 확인

1. 브라우저: `https://excel-ai-chat-364392170079.asia-northeast3.run.app/chat`
2. **Ctrl+Shift+R** (강력 새로고침)
3. 헤더 로고, **← AiBle BOX** → `https://aible-box.vercel.app/` 이동 확인
4. 파일 업로드 → 학습 → 질문 테스트

---

## 런타임 환경변수만 바꿀 때 (재빌드 없음)

`GEMINI_MODEL`, `UPLOAD_MAX_BYTES` 등만 바꿀 때는 **STEP 1 생략**, STEP 2의 `--set-env-vars` 만 수정해서 `gcloud run deploy` 실행.

예: 모델만 변경

```powershell
gcloud run deploy excel-ai-chat --image asia-northeast3-docker.pkg.dev/digitalds-6ef38/excel-ai-chat/excel-ai-chat:latest --region asia-northeast3 --update-env-vars "GEMINI_MODEL=gemini-3-flash-preview"
```

(기존 env/secret은 유지하려면 콘솔 **Cloud Run → 서비스 → 새 리비전 수정**이 더 안전할 수 있습니다.)

---

## Secret Manager

| 시크릿 | 용도 |
|--------|------|
| `GEMINI_API_KEY` | Gemini API |
| `CRON_SECRET` | 매일 고아 파일 정리 cron 인증 |

값 변경 (줄바꿈 없이):

```powershell
$p = "$env:TEMP\sec.txt"
[System.IO.File]::WriteAllText($p, "새_값", (New-Object System.Text.ASCIIEncoding))
gcloud secrets versions add GEMINI_API_KEY --data-file="$p"
Remove-Item $p
```

변경 후 **STEP 2 배포** 한 번 더 (또는 콘솔에서 새 리비전).

---

## 고아 파일 정리 (Cloud Scheduler)

- URL: `https://excel-ai-chat-364392170079.asia-northeast3.run.app/chat/api/cron/cleanup-blobs`
- 방법: `POST`
- 헤더: `Authorization: Bearer <CRON_SECRET>`

수동 테스트:

```powershell
curl.exe -X POST "https://excel-ai-chat-364392170079.asia-northeast3.run.app/chat/api/cron/cleanup-blobs" -H "Authorization: Bearer <CRON_SECRET>"
```

`{"ok":true,"provider":"gcs",...}` 이면 성공.

---

## 트러블슈팅

### `INVALID_ARGUMENT: invalid image name` (substitutions 깨짐)

PowerShell에서 substitutions를 **따옴표 없이** 썼을 때 발생.  
→ STEP 1 명령 전체를 `"..."` 로 감싼 버전 사용.

### `Permission denied on secret`

```powershell
gcloud secrets add-iam-policy-binding GEMINI_API_KEY --member="serviceAccount:364392170079-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding CRON_SECRET --member="serviceAccount:364392170079-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

### GCS 업로드/삭제 실패

```powershell
gcloud storage buckets add-iam-policy-binding gs://seesign-chat-uploads-prod --member="serviceAccount:364392170079-compute@developer.gserviceaccount.com" --role="roles/storage.objectAdmin"
```

### 헤더 로고 깨짐

- 원인: `basePath=/chat` 인데 `/aible_logo.svg` 로 요청 (404)
- 수정: `publicAsset("/aible_logo.svg")` 사용 (`src/app/page.tsx`) — **빌드+배포 필요**

### AiBle BOX 링크가 localhost로 감

- `_NEXT_PUBLIC_AIBLE_BOX_URL=https://aible-box.vercel.app` 로 **다시 빌드**

---

## Vercel과의 관계

| 항목 | Vercel | Cloud Run |
|------|--------|-----------|
| 배포 | `git push` | 위 STEP 1 + 2 |
| 파일 저장 | Vercel Blob | GCS (`GCS_UPLOAD_BUCKET`) |
| 업로드 한도 | ~4.5MB | 30MB (`UPLOAD_MAX_BYTES`) |
| 사용자 URL (목표) | `aible-box.vercel.app/chat` | `chat.digitalds.store/chat` (예정) |

Cloud Run이 정상 확인될 때까지 **Vercel 환경변수·Blob은 삭제하지 마세요.**

---

## 한 줄 치트시트

```powershell
# 1. 빌드
gcloud builds submit --config cloudbuild.yaml --substitutions="_REGION=asia-northeast3,_REPO=excel-ai-chat,_SERVICE=excel-ai-chat,_TAG=latest,_NEXT_PUBLIC_BASE_PATH=/chat,_NEXT_PUBLIC_AIBLE_BOX_URL=https://aible-box.vercel.app,_NEXT_PUBLIC_SEESIGN_ADMIN_URL=https://seesign-admin.digitalds.store/main,_NEXT_PUBLIC_CHAT_GUIDE_URL=https://seesign.mintlify.app/guide/chat/ready"

# 2. 배포
gcloud run deploy excel-ai-chat --image asia-northeast3-docker.pkg.dev/digitalds-6ef38/excel-ai-chat/excel-ai-chat:latest --region asia-northeast3 --allow-unauthenticated --memory 4Gi --cpu 2 --timeout 900 --concurrency 20 --set-env-vars "GEMINI_MODEL=gemini-3.5-flash,GEMINI_EMBEDDING_MODEL=gemini-embedding-001,RAG_TOP_K=24,RAG_EMBED_BATCH_SIZE=100,RAG_EMBED_CONCURRENCY=8,RAG_ROWS_PER_CHUNK=25,RAG_EMBEDDING_DIMENSIONS=768,RAG_INDEX_QA=true,RAG_MAX_QA_INDEX_ROWS=5000,GEMINI_MAX_DIGEST_BODY_CHARS=3000,GEMINI_MAX_LOCATION_DIGEST_CHARS=80000,LECTURE_HOTSPOT_SEGMENT_MINUTES=10,LECTURE_TIME_TOLERANCE_MINUTES=5,COMMUNITY_MAP_CHARS_PER_ROW=280,UPLOAD_MAX_BYTES=31457280,CHAT_MAX_REQUEST_BYTES=25000000,BLOB_TTL_HOURS=24,GCS_UPLOAD_BUCKET=seesign-chat-uploads-prod" --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,CRON_SECRET=CRON_SECRET:latest"
```

---

## 관련 파일

| 파일 | 역할 |
|------|------|
| `cloudbuild.yaml` | Cloud Build 빌드·푸시 설정 |
| `Dockerfile` | Next.js standalone 이미지 |
| `next.config.ts` | `basePath`, `output: standalone` |
| `src/lib/storage/` | GCS / Vercel Blob 저장소 |
| `src/lib/base-path.ts` | `withBasePath`, `publicAsset` |
