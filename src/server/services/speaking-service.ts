import "server-only";

import { getAIService } from "@/lib/ai/ai-service";
import { buildSpeakingAnalysisPrompt, wrapTranscript } from "@/lib/ai/prompts/speaking";
import { speakingAnalysisSchema, type SpeakingAnalysis } from "@/lib/ai/schemas";
import { prisma } from "@/lib/db/client";
import { UploadValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildSpeakingContext } from "@/server/services/context-builder";
import { recordCorrections } from "@/server/services/grammar-service";

/**
 * Speaking mode: transcription and spoken-English analysis.
 *
 * Audio is treated as transient. It is validated, sent to the speech provider,
 * and discarded — only the transcript is persisted. That keeps the privacy
 * story simple (no voice recordings at rest) and avoids needing a blob store.
 */

/** 10 MB — roughly 10 minutes of compressed speech, well past a practice turn. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Container formats browsers actually produce from MediaRecorder, plus the
 * common ones a file picker might yield. Anything else is rejected rather than
 * forwarded to the provider.
 */
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/m4a",
  "audio/x-m4a",
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
};

export interface ValidatedAudio {
  buffer: ArrayBuffer;
  mimeType: string;
  fileName: string;
}

/**
 * Validates an uploaded audio blob.
 *
 * The `codecs=` parameter that MediaRecorder appends is stripped before the
 * allow-list check, since `audio/webm;codecs=opus` is the normal browser output.
 */
export async function validateAudioUpload(file: File): Promise<ValidatedAudio> {
  if (file.size === 0) {
    throw new UploadValidationError("That recording is empty. Try recording again.");
  }

  if (file.size > MAX_AUDIO_BYTES) {
    throw new UploadValidationError("That recording is too long. Keep it under about 10 minutes.");
  }

  const baseType = file.type.split(";")[0]?.trim().toLowerCase() ?? "";

  if (!ALLOWED_AUDIO_TYPES.has(baseType)) {
    throw new UploadValidationError(
      "That audio format isn't supported. Please record with your browser's microphone.",
    );
  }

  const buffer = await file.arrayBuffer();

  // Size is re-checked after reading: `File.size` is client-reported metadata,
  // while the buffer length is what we actually received.
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new UploadValidationError("That recording is too long. Keep it under about 10 minutes.");
  }

  const extension = EXTENSION_BY_TYPE[baseType] ?? "webm";

  return {
    buffer,
    mimeType: baseType,
    // The provider infers format from the filename, so it is generated here
    // rather than trusting the client-supplied name.
    fileName: `speech.${extension}`,
  };
}

export async function transcribeSpeech(
  userId: string,
  audio: ValidatedAudio,
  signal?: AbortSignal,
): Promise<{ text: string; provider: string; durationSec?: number }> {
  const result = await getAIService().transcribeAudio({
    task: "transcription",
    userId,
    audio: audio.buffer,
    mimeType: audio.mimeType,
    fileName: audio.fileName,
    language: "en",
    signal,
  });

  return {
    text: result.text.trim(),
    provider: result.provider,
    durationSec: result.durationSec,
  };
}

export interface RecordSpeakingParams {
  userId: string;
  transcript: string;
  durationSec: number;
  conversationId?: string;
  transcriptionProvider?: string;
  signal?: AbortSignal;
}

/** Analyses a spoken turn and stores the session. */
export async function analyzeSpeaking(
  params: RecordSpeakingParams,
): Promise<{ sessionId: string; analysis: SpeakingAnalysis; wordsPerMinute: number | null }> {
  const context = await buildSpeakingContext(params.userId);

  const result = await getAIService().generateStructured({
    task: "speaking_analysis",
    userId: params.userId,
    system: buildSpeakingAnalysisPrompt(context),
    messages: [{ role: "user", content: wrapTranscript(params.transcript) }],
    schema: speakingAnalysisSchema,
    schemaName: "SpeakingAnalysis",
    temperature: 0.2,
    maxOutputTokens: 1800,
    signal: params.signal,
  });

  const analysis = result.data;
  const wordCount = params.transcript.trim().split(/\s+/).filter(Boolean).length;

  // Words per minute is arithmetic, not a judgement — computed here rather than
  // asked of the model. Very short clips give a meaningless rate, so they're
  // reported as null instead of a wild number.
  const wordsPerMinute =
    params.durationSec >= 5 ? Math.round((wordCount / params.durationSec) * 60) : null;

  const session = await prisma.speakingSession.create({
    data: {
      userId: params.userId,
      conversationId: params.conversationId ?? null,
      transcript: params.transcript,
      durationSec: params.durationSec,
      wordCount,
      wordsPerMinute,
      confidenceScore: analysis.fluencyScore,
      transcriptionProvider: params.transcriptionProvider ?? null,
      analysis: analysis as unknown as object,
    },
    select: { id: true },
  });

  try {
    await recordCorrections({
      userId: params.userId,
      corrections: analysis.corrections,
      source: "speaking",
      conversationId: params.conversationId,
    });
  } catch (error) {
    logger.warn("Failed to record speaking corrections", {
      userId: params.userId,
      error: String(error),
    });
  }

  return { sessionId: session.id, analysis, wordsPerMinute };
}

export async function listSpeakingSessions(userId: string, limit: number) {
  return prisma.speakingSession.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      transcript: true,
      durationSec: true,
      wordCount: true,
      wordsPerMinute: true,
      confidenceScore: true,
      analysis: true,
      createdAt: true,
    },
  });
}
