import { TRACTATES, generateDafListForTractate } from "../data/tractates";
import type {
  AudioSyncMap,
  AudioSyncReviewStatus,
  AudioSyncSection,
  AudioSyncSegment,
  WordAnchor,
} from "./audioSyncTypes";

export interface AudioSyncValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface AudioSyncValidationResult {
  valid: boolean;
  issues: AudioSyncValidationIssue[];
  map?: AudioSyncMap | undefined;
}

const VALID_REVIEW_STATUSES: ReadonlySet<AudioSyncReviewStatus> = new Set([
  "auto",
  "verified",
  "needs-review",
  "unmatched",
]);

const VALID_SECTIONS: ReadonlySet<AudioSyncSection> = new Set(["mishnah", "gemara"]);

const DAF_ID_PATTERN = /^\d+[ab]$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates `dafId` against both format (`^\d+[ab]$`) and the tractate's printed range (`2a`..`${lastDaf}b`).
 */
export function isValidDafIdForTractate(tractateId: string, dafId: string): boolean {
  const tractate = TRACTATES.find((t) => t.id === tractateId);
  if (!tractate) return false;
  if (!DAF_ID_PATTERN.test(dafId)) return false;
  const validDafs = generateDafListForTractate(tractate.lastDaf);
  return validDafs.includes(dafId);
}

function validateAnchor(
  rawAnchor: unknown,
  path: string,
  issues: AudioSyncValidationIssue[],
): WordAnchor | null {
  if (!isPlainRecord(rawAnchor)) {
    issues.push({ path, code: "INVALID_ANCHOR_OBJECT", message: "Anchor must be an object." });
    return null;
  }

  const normalizedWord = rawAnchor["normalizedWord"];
  const section = rawAnchor["section"];
  const occurrence = rawAnchor["occurrence"];
  const readingOrderIndex = rawAnchor["readingOrderIndex"];
  const rawWord = rawAnchor["rawWord"];
  const prevWords = rawAnchor["prevWords"];
  const nextWords = rawAnchor["nextWords"];
  const lineFingerprint = rawAnchor["lineFingerprint"];
  const rowIdHint = rawAnchor["rowIdHint"];
  const quoteAfter = rawAnchor["quoteAfter"];

  if (typeof normalizedWord !== "string" || normalizedWord.trim().length === 0) {
    issues.push({
      path: `${path}.normalizedWord`,
      code: "INVALID_ANCHOR_WORD",
      message: "Anchor normalizedWord must be a non-empty string.",
    });
  }

  if (typeof section !== "string" || !VALID_SECTIONS.has(section as AudioSyncSection)) {
    issues.push({
      path: `${path}.section`,
      code: "INVALID_ANCHOR_SECTION",
      message: 'Anchor section must be "mishnah" or "gemara".',
    });
  }

  if (typeof occurrence !== "number" || !Number.isInteger(occurrence) || occurrence < 1) {
    issues.push({
      path: `${path}.occurrence`,
      code: "INVALID_ANCHOR_OCCURRENCE",
      message: "Anchor occurrence must be an integer >= 1.",
    });
  }

  if (
    typeof readingOrderIndex !== "number" ||
    !Number.isInteger(readingOrderIndex) ||
    readingOrderIndex < 0
  ) {
    issues.push({
      path: `${path}.readingOrderIndex`,
      code: "INVALID_ANCHOR_READING_ORDER",
      message: "Anchor readingOrderIndex must be an integer >= 0.",
    });
  }

  if (rawWord !== undefined && typeof rawWord !== "string") {
    issues.push({
      path: `${path}.rawWord`,
      code: "INVALID_ANCHOR_RAW_WORD",
      message: "Anchor rawWord must be a string when provided.",
    });
  }

  if (
    prevWords !== undefined &&
    (!Array.isArray(prevWords) || prevWords.some((w) => typeof w !== "string"))
  ) {
    issues.push({
      path: `${path}.prevWords`,
      code: "INVALID_ANCHOR_CONTEXT",
      message: "Anchor prevWords must be an array of strings.",
    });
  }

  if (
    nextWords !== undefined &&
    (!Array.isArray(nextWords) || nextWords.some((w) => typeof w !== "string"))
  ) {
    issues.push({
      path: `${path}.nextWords`,
      code: "INVALID_ANCHOR_CONTEXT",
      message: "Anchor nextWords must be an array of strings.",
    });
  }

  if (lineFingerprint !== undefined && typeof lineFingerprint !== "string") {
    issues.push({
      path: `${path}.lineFingerprint`,
      code: "INVALID_ANCHOR_LINE_FINGERPRINT",
      message: "Anchor lineFingerprint must be a string.",
    });
  }

  if (rowIdHint !== undefined && typeof rowIdHint !== "string") {
    issues.push({
      path: `${path}.rowIdHint`,
      code: "INVALID_ANCHOR_ROW_HINT",
      message: "Anchor rowIdHint must be a string.",
    });
  }

  if (quoteAfter !== undefined && quoteAfter !== '"' && quoteAfter !== "'") {
    issues.push({
      path: `${path}.quoteAfter`,
      code: "INVALID_ANCHOR_QUOTE",
      message: "Anchor quoteAfter must be '\"' or \"'\".",
    });
  }

  if (
    typeof normalizedWord === "string" &&
    normalizedWord.trim().length > 0 &&
    typeof section === "string" &&
    VALID_SECTIONS.has(section as AudioSyncSection) &&
    typeof occurrence === "number" &&
    Number.isInteger(occurrence) &&
    occurrence >= 1 &&
    typeof readingOrderIndex === "number" &&
    Number.isInteger(readingOrderIndex) &&
    readingOrderIndex >= 0
  ) {
    return rawAnchor as unknown as WordAnchor;
  }

  return null;
}

/**
 * Validates an `AudioSyncMap` payload without mutating it.
 * Enforces tractate & daf range, segment timing invariants, confidence bounds,
 * review statuses, and anchor integrity.
 */
export function validateAudioSyncMap(input: unknown): AudioSyncValidationResult {
  const issues: AudioSyncValidationIssue[] = [];

  if (!isPlainRecord(input)) {
    return {
      valid: false,
      issues: [{ path: "$", code: "INVALID_ROOT", message: "AudioSyncMap must be an object." }],
    };
  }

  const version = input["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    issues.push({
      path: "version",
      code: "INVALID_VERSION",
      message: "version must be a positive integer.",
    });
  }

  const tractateId = input["tractateId"];
  const tractateExists =
    typeof tractateId === "string" && TRACTATES.some((t) => t.id === tractateId);
  if (!tractateExists) {
    issues.push({
      path: "tractateId",
      code: "UNKNOWN_TRACTATE",
      message: `Unknown tractateId "${String(tractateId ?? "")}".`,
    });
  }

  const dafId = input["dafId"];
  if (typeof dafId !== "string" || !DAF_ID_PATTERN.test(dafId)) {
    issues.push({
      path: "dafId",
      code: "INVALID_DAF_FORMAT",
      message: `Invalid dafId "${String(dafId ?? "")}". Expected format like "2a" or "15b".`,
    });
  } else if (tractateExists && !isValidDafIdForTractate(tractateId as string, dafId)) {
    issues.push({
      path: "dafId",
      code: "DAF_OUT_OF_RANGE",
      message: `dafId "${dafId}" is out of range for tractate "${tractateId as string}".`,
    });
  }

  const source = input["source"];
  if (source !== undefined) {
    if (!isPlainRecord(source)) {
      issues.push({
        path: "source",
        code: "INVALID_SOURCE",
        message: "source metadata must be an object when provided.",
      });
    } else if (
      source["durationMs"] !== undefined &&
      (typeof source["durationMs"] !== "number" ||
        !Number.isFinite(source["durationMs"]) ||
        source["durationMs"] <= 0)
    ) {
      issues.push({
        path: "source.durationMs",
        code: "INVALID_DURATION",
        message: "source.durationMs must be a finite number > 0.",
      });
    }
  }

  const segments = input["segments"];
  if (!Array.isArray(segments)) {
    issues.push({
      path: "segments",
      code: "INVALID_SEGMENTS",
      message: "segments must be an array.",
    });
  } else {
    const seenSegmentIds = new Set<string>();
    let prevStartMs = -Infinity;

    for (let i = 0; i < segments.length; i++) {
      const segPath = `segments[${i}]`;
      const rawSeg = segments[i];
      if (!isPlainRecord(rawSeg)) {
        issues.push({
          path: segPath,
          code: "INVALID_SEGMENT_OBJECT",
          message: "Segment must be an object.",
        });
        continue;
      }

      const segId = rawSeg["id"];
      if (typeof segId !== "string" || segId.trim().length === 0) {
        issues.push({
          path: `${segPath}.id`,
          code: "INVALID_SEGMENT_ID",
          message: "Segment id must be a non-empty string.",
        });
      } else if (seenSegmentIds.has(segId)) {
        issues.push({
          path: `${segPath}.id`,
          code: "DUPLICATE_SEGMENT_ID",
          message: `Duplicate segment id "${segId}".`,
        });
      } else {
        seenSegmentIds.add(segId);
      }

      const startMs = rawSeg["startMs"];
      const endMs = rawSeg["endMs"];
      const hasValidStart = typeof startMs === "number" && Number.isFinite(startMs) && startMs >= 0;
      const hasValidEnd = typeof endMs === "number" && Number.isFinite(endMs);

      if (!hasValidStart) {
        issues.push({
          path: `${segPath}.startMs`,
          code: "INVALID_START_MS",
          message: "Segment startMs must be a finite number >= 0.",
        });
      } else {
        if (startMs < prevStartMs) {
          issues.push({
            path: `${segPath}.startMs`,
            code: "NON_CHRONOLOGICAL_SEGMENT",
            message: `Segment startMs (${startMs}) precedes previous segment startMs (${prevStartMs}).`,
          });
        }
        prevStartMs = startMs;
      }

      if (!hasValidEnd || (hasValidStart && (endMs as number) <= (startMs as number))) {
        issues.push({
          path: `${segPath}.endMs`,
          code: "INVALID_END_MS",
          message: "Segment endMs must be a finite number strictly greater than startMs.",
        });
      }

      if (typeof rawSeg["textHe"] !== "string") {
        issues.push({
          path: `${segPath}.textHe`,
          code: "INVALID_TEXT_HE",
          message: "Segment textHe must be a string.",
        });
      }

      if (rawSeg["topicKa"] !== undefined && typeof rawSeg["topicKa"] !== "string") {
        issues.push({
          path: `${segPath}.topicKa`,
          code: "INVALID_TOPIC_KA",
          message: "Segment topicKa must be a string when provided.",
        });
      }

      const confidence = rawSeg["confidence"];
      if (
        typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        issues.push({
          path: `${segPath}.confidence`,
          code: "INVALID_CONFIDENCE",
          message: "Segment confidence must be a finite number between 0 and 1.",
        });
      }

      const reviewStatus = rawSeg["reviewStatus"];
      if (
        typeof reviewStatus !== "string" ||
        !VALID_REVIEW_STATUSES.has(reviewStatus as AudioSyncReviewStatus)
      ) {
        issues.push({
          path: `${segPath}.reviewStatus`,
          code: "INVALID_REVIEW_STATUS",
          message:
            'Segment reviewStatus must be one of "auto", "verified", "needs-review", or "unmatched".',
        });
      }

      const segDafId = rawSeg["dafId"];
      if (segDafId !== undefined) {
        if (typeof segDafId !== "string" || !DAF_ID_PATTERN.test(segDafId)) {
          issues.push({
            path: `${segPath}.dafId`,
            code: "INVALID_SEGMENT_DAF_FORMAT",
            message: `Invalid segment dafId "${String(segDafId)}".`,
          });
        } else if (tractateExists && !isValidDafIdForTractate(tractateId as string, segDafId)) {
          issues.push({
            path: `${segPath}.dafId`,
            code: "SEGMENT_DAF_OUT_OF_RANGE",
            message: `Segment dafId "${segDafId}" is out of range for tractate "${tractateId as string}".`,
          });
        }
      }

      const dafTransition = rawSeg["dafTransition"];
      if (dafTransition !== undefined) {
        if (!isPlainRecord(dafTransition)) {
          issues.push({
            path: `${segPath}.dafTransition`,
            code: "INVALID_DAF_TRANSITION",
            message: "dafTransition must be an object.",
          });
        } else {
          const fromDafId = dafTransition["fromDafId"];
          const toDafId = dafTransition["toDafId"];
          if (
            typeof fromDafId !== "string" ||
            (tractateExists && !isValidDafIdForTractate(tractateId as string, fromDafId)) ||
            (!tractateExists && !DAF_ID_PATTERN.test(String(fromDafId)))
          ) {
            issues.push({
              path: `${segPath}.dafTransition.fromDafId`,
              code: "INVALID_TRANSITION_FROM_DAF",
              message: `Invalid dafTransition.fromDafId "${String(fromDafId ?? "")}".`,
            });
          }
          if (
            typeof toDafId !== "string" ||
            (tractateExists && !isValidDafIdForTractate(tractateId as string, toDafId)) ||
            (!tractateExists && !DAF_ID_PATTERN.test(String(toDafId)))
          ) {
            issues.push({
              path: `${segPath}.dafTransition.toDafId`,
              code: "INVALID_TRANSITION_TO_DAF",
              message: `Invalid dafTransition.toDafId "${String(toDafId ?? "")}".`,
            });
          }
          if (typeof fromDafId === "string" && fromDafId === toDafId) {
            issues.push({
              path: `${segPath}.dafTransition`,
              code: "NOOP_DAF_TRANSITION",
              message: "dafTransition.toDafId must differ from dafTransition.fromDafId.",
            });
          }
        }
      }

      const anchors = rawSeg["anchors"];
      if (!Array.isArray(anchors)) {
        issues.push({
          path: `${segPath}.anchors`,
          code: "INVALID_ANCHORS",
          message: "Segment anchors must be an array.",
        });
      } else {
        const seenAnchorKeys = new Set<string>();
        for (let a = 0; a < anchors.length; a++) {
          const anchorPath = `${segPath}.anchors[${a}]`;
          const validAnchor = validateAnchor(anchors[a], anchorPath, issues);
          if (validAnchor) {
            const dedupeKey = `${validAnchor.section}|${validAnchor.normalizedWord}|${validAnchor.readingOrderIndex}|${validAnchor.occurrence}`;
            if (seenAnchorKeys.has(dedupeKey)) {
              issues.push({
                path: anchorPath,
                code: "DUPLICATE_ANCHOR",
                message: `Duplicate anchor "${validAnchor.normalizedWord}" at readingOrderIndex ${validAnchor.readingOrderIndex} in segment "${String(segId ?? i)}".`,
              });
            } else {
              seenAnchorKeys.add(dedupeKey);
            }
          }
        }
      }
    }
  }

  if (issues.length === 0) {
    return {
      valid: true,
      issues: [],
      map: input as unknown as AudioSyncMap,
    };
  }

  return { valid: false, issues };
}

export function assertValidAudioSyncMap(input: unknown): AudioSyncMap {
  const res = validateAudioSyncMap(input);
  if (!res.valid || !res.map) {
    const summary = res.issues
      .slice(0, 5)
      .map((iss) => `${iss.path}: ${iss.message}`)
      .join("; ");
    throw new Error(`Invalid AudioSyncMap: ${summary}`);
  }
  return res.map;
}

export type ValidatedAudioSyncSegment = AudioSyncSegment;
