import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import * as protoLoader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';

const PROTO_PATH = resolve(__dirname, '..', 'proto', 'ai_pilot', 'v1', 'ai_pilot.proto');

describe('ai_pilot.proto', () => {
  it('loads cleanly with proto-loader and exposes both services', () => {
    const def = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: Number,
      enums: Number,
      defaults: true,
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(def) as Record<string, unknown>;
    const v1 = (pkg.ses as Record<string, unknown>).ai_pilot as Record<string, unknown>;
    const services = v1.v1 as Record<string, unknown>;
    assert.equal(typeof services.AiPilot, 'function', 'AiPilot service stub missing');
    assert.equal(typeof services.PdfProcessing, 'function', 'PdfProcessing service stub missing');
  });
});
