import { prepareAssistantMarkdownForRender } from "@/lib/markdown";

/** 답변 마크다운을 클립보드용 평문으로 변환합니다. */
export function answerToPlainText(markdown: string): string {
  let text = prepareAssistantMarkdownForRender(markdown);

  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/^>\s?/gm, "");
  text = text.replace(/^[-*+]\s+/gm, "• ");
  text = text.replace(/^\d+\.\s+/gm, (match) => match);
  text = text.replace(/^---+$/gm, "────────────────");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

export function buildAnswerExportFilename(extension: "pdf" | "txt"): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("-");
  return `SEE-SIGN-답변-${stamp}.${extension}`;
}

/** 클론 문서에서 Tailwind v4 lab/oklch 등 미지원 색상 파싱 오류를 방지합니다. */
function prepareCloneForCapture(
  clonedDoc: Document,
  originalRoot: HTMLElement,
  clonedRoot: HTMLElement
): void {
  clonedDoc.querySelectorAll("style, link[rel='stylesheet']").forEach((node) => node.remove());

  const props = [
    "color",
    "backgroundColor",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderTopStyle",
    "borderRightStyle",
    "borderBottomStyle",
    "borderLeftStyle",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontFamily",
    "lineHeight",
    "textAlign",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "display",
    "width",
    "maxWidth",
    "borderRadius",
    "textDecoration",
    "listStyleType",
    "verticalAlign",
  ] as const;

  const toKebab = (prop: string) => prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

  const inlineStyles = (originalEl: Element, clonedEl: HTMLElement) => {
    const computed = window.getComputedStyle(originalEl);
    for (const prop of props) {
      const value = computed[prop];
      if (value) clonedEl.style.setProperty(toKebab(prop), value);
    }

    const originalChildren = originalEl.children;
    const clonedChildren = clonedEl.children;
    for (let i = 0; i < originalChildren.length; i++) {
      const child = clonedChildren[i];
      if (child instanceof HTMLElement) {
        inlineStyles(originalChildren[i], child);
      }
    }
  };

  inlineStyles(originalRoot, clonedRoot);
}

/** 렌더된 답변 영역을 A4 PDF로 저장합니다. */
export async function downloadAnswerPdf(
  element: HTMLElement,
  filename = buildAnswerExportFilename("pdf")
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    onclone: (clonedDoc, clonedElement) => {
      prepareCloneForCapture(clonedDoc, element, clonedElement);
    },
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const margin = 12;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const imgHeight = (canvas.height * contentWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = margin;

  pdf.addImage(imgData, "PNG", margin, position, contentWidth, imgHeight);
  heightLeft -= contentHeight;

  while (heightLeft > 0) {
    pdf.addPage();
    position = margin - (imgHeight - heightLeft);
    pdf.addImage(imgData, "PNG", margin, position, contentWidth, imgHeight);
    heightLeft -= contentHeight;
  }

  pdf.save(filename);
}

export async function copyAnswerText(markdown: string): Promise<void> {
  const plain = answerToPlainText(markdown);
  if (!plain) throw new Error("복사할 내용이 없습니다.");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(plain);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = plain;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
