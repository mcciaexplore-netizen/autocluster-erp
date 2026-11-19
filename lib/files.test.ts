import { describe, expect, it } from "vitest";
import { fileProblem, formatFileSize, isValidUploadPath, safeFileName, uploadPath } from "./files";

describe("uploaded files", () => {
  it("accepts PDF, JPG and PNG up to 10 MB only", () => {
    expect(fileProblem({ name: "po.pdf", type: "application/pdf", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "po.JPG", type: "", size: 1000 })).toBeNull();
    expect(fileProblem({ name: "po.png", type: "image/png", size: 10 * 1024 * 1024 })).toBeNull();
    expect(fileProblem({ name: "po.png", type: "image/png", size: 10 * 1024 * 1024 + 1 })).toMatch(/up to 10 MB/);
    expect(fileProblem({ name: "po.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 })).toMatch(/PDF, JPG or PNG/);
    expect(fileProblem({ name: "x.html", type: "text/html", size: 10 })).not.toBeNull();
  });
  it("keeps storage paths tidy and inside the right folder", () => {
    expect(safeFileName("PO 4500/12 (final).pdf")).toBe("PO-4500-12-final-.pdf");
    expect(uploadPath("local", "PO", "../../etc/passwd")).toBe("local/po/etc-passwd");
    expect(isValidUploadPath("local/po/PO-1-AbC123.pdf", "local")).toBe(true);
    expect(isValidUploadPath("live/po/PO-1.pdf", "local")).toBe(false);
    expect(isValidUploadPath("local/po/../x.pdf", "local")).toBe(false);
    expect(isValidUploadPath("local/other/x.pdf", "local")).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatFileSize(21911)).toBe("21 KB");
    expect(formatFileSize(2_400_000)).toBe("2.3 MB");
  });
});
