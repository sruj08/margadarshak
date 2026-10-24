// P2 environment variables (plan §2.11.6): all optional; a set-but-invalid value is a ConfigError.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError } from "../src/lib/config.ts";
import { testConfig } from "./helpers.ts";

const R2 = {
  R2_ACCOUNT_ID: "0123456789ABCDEF0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
};

describe("config: P2 variables", () => {
  it("defaults every P2 variable to unset / off", () => {
    const c = testConfig();
    assert.equal(c.fieldKitStatsScript, undefined);
    assert.equal(c.faultInjectionClipBlur, "off");
    assert.equal(c.ffmpegPath, undefined);
    assert.equal(c.blurModelDir, undefined);
    assert.equal(c.r2, undefined);
    assert.equal(c.mediaPublicBaseUrl, undefined);
  });

  it("reads MEDIA_PUBLIC_BASE_URL without a trailing slash", () => {
    assert.equal(
      testConfig({ MEDIA_PUBLIC_BASE_URL: "https://media.example.org/" }).mediaPublicBaseUrl,
      "https://media.example.org",
    );
    assert.throws(() => testConfig({ MEDIA_PUBLIC_BASE_URL: "not a url" }), ConfigError);
    assert.throws(
      () => testConfig({ MEDIA_PUBLIC_BASE_URL: "ftp://media.example.org" }),
      ConfigError,
    );
  });

  it("reads paths and the fault-injection switch", () => {
    const c = testConfig({
      FIELD_KIT_STATS_SCRIPT: " /srv/field-kit/nazar_stats.mjs ",
      FAULT_INJECTION_CLIP_BLUR: "ONCE",
      FFMPEG_PATH: "C:\\ffmpeg\\bin\\ffmpeg.exe",
      BLUR_MODEL_DIR: "/srv/models",
    });
    assert.equal(c.fieldKitStatsScript, "/srv/field-kit/nazar_stats.mjs");
    assert.equal(c.faultInjectionClipBlur, "once");
    assert.equal(c.ffmpegPath, "C:\\ffmpeg\\bin\\ffmpeg.exe");
    assert.equal(c.blurModelDir, "/srv/models");
    assert.equal(
      testConfig({ FAULT_INJECTION_CLIP_BLUR: "always" }).faultInjectionClipBlur,
      "always",
    );
    assert.equal(testConfig({ FAULT_INJECTION_CLIP_BLUR: "false" }).faultInjectionClipBlur, "off");
    assert.equal(testConfig({ FFMPEG_PATH: "  " }).ffmpegPath, undefined);
  });

  it("rejects invalid values", () => {
    assert.throws(() => testConfig({ FAULT_INJECTION_CLIP_BLUR: "twice" }), ConfigError);
    assert.throws(() => testConfig({ FIELD_KIT_STATS_SCRIPT: "/srv/nazar_stats.py" }), ConfigError);
    assert.throws(() => testConfig({ FFMPEG_PATH: "ffmpeg\n-rm" }), ConfigError);
  });

  it("builds R2 config only when all three credentials are set, and validates names", () => {
    const c = testConfig({ ...R2, R2_BUCKET_CLIPS: "md-clips", R2_BUCKET_INGEST: "md-ingest" });
    assert.deepEqual(c.r2, {
      accountId: "0123456789abcdef0123456789abcdef",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      bucketClips: "md-clips",
      bucketIngest: "md-ingest",
    });
    assert.equal(
      testConfig({ R2_BUCKET_CLIPS: "md-clips" }).r2,
      undefined,
      "buckets alone do not enable R2",
    );
    assert.throws(
      () => testConfig({ R2_ACCOUNT_ID: R2.R2_ACCOUNT_ID }),
      /missing: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY/,
    );
    assert.throws(() => testConfig({ ...R2, R2_ACCOUNT_ID: "not-hex" }), ConfigError);
    assert.throws(() => testConfig({ ...R2, R2_BUCKET_CLIPS: "Bad_Bucket" }), ConfigError);
  });
});
