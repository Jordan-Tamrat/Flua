import { limitByUser } from "@/lib/api/guards";
import { apiSuccess, handleAuthedRoute } from "@/lib/api/response";
import { UploadValidationError } from "@/lib/errors";
import { transcribeSpeech, validateAudioUpload } from "@/server/services/speaking-service";

/**
 * Speech-to-text.
 *
 * Takes a multipart upload, validates it, forwards the bytes to the configured
 * speech provider and returns the transcript. The audio itself is never written
 * to disk or to the database — it exists only for the life of the request.
 */

export const dynamic = "force-dynamic";
/** Transcription is the slowest call in the app; give it room on hosts that cap. */
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAuthedRoute({ endpoint: "POST /api/ai/speaking/transcribe" }, async (session) => {
    limitByUser(session.userId, "transcription");

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new UploadValidationError("We couldn't read that upload. Please try recording again.");
    }

    const file = formData.get("audio");
    if (!(file instanceof File)) {
      throw new UploadValidationError("No audio was included in the request.");
    }

    const audio = await validateAudioUpload(file);
    const result = await transcribeSpeech(session.userId, audio, request.signal);

    if (result.text.length === 0) {
      throw new UploadValidationError(
        "We couldn't hear anything in that recording. Try speaking a little louder or closer to the microphone.",
      );
    }

    return apiSuccess({
      transcript: result.text,
      durationSec: result.durationSec,
      provider: result.provider,
    });
  });
}
