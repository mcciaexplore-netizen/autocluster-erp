/**
 * Hands the browser a short-lived upload ticket so files up to 10 MB go straight to Vercel Blob
 * (server functions only accept about 4.5 MB). Signed-in users only; PDF/JPG/PNG up to 10 MB.
 * The file is registered afterwards by the registerUpload server action.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { isSignedIn } from "@/lib/auth-guard";
import { BLOB_NOT_SET_MESSAGE, blobEnv, blobToken } from "@/lib/blob";
import { ALLOWED_FILE_TYPES, isValidUploadPath, MAX_FILE_BYTES } from "@/lib/files";

export async function POST(request: Request) {
  if (!(await isSignedIn())) return Response.json({ error: "Please sign in first." }, { status: 401 });
  const token = blobToken();
  if (!token) return Response.json({ error: BLOB_NOT_SET_MESSAGE }, { status: 503 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  // We never ask Blob to call us back (it couldn't reach a local computer anyway).
  if (body.type !== "blob.generate-client-token") return Response.json({ error: "Bad request." }, { status: 400 });

  try {
    const result = await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!isValidUploadPath(pathname, blobEnv())) throw new Error("Invalid upload path");
        return {
          allowedContentTypes: [...ALLOWED_FILE_TYPES],
          maximumSizeInBytes: MAX_FILE_BYTES,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    console.error("upload token", e);
    return Response.json({ error: "We couldn't start the upload. Please try again." }, { status: 400 });
  }
}
