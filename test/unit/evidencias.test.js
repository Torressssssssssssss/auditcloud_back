const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { isolateExternals } = require('./helpers/externalIsolation');

function fixture(t, { uploadError, publicError } = {}) {
  const { replace } = isolateExternals(t, {
    FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'proyecto-test' }),
    FIREBASE_STORAGE_BUCKET: 'evidencias.example.test'
  });
  const chunks = [];
  const file = {
    createWriteStream: t.mock.fn(() => new Writable({ write(chunk, encoding, callback) {
      if (uploadError) return callback(uploadError);
      chunks.push(Buffer.from(chunk)); callback();
    } })),
    makePublic: t.mock.fn(async () => { if (publicError) throw publicError; }),
    getSignedUrl: t.mock.fn(async () => ['https://signed.example.test/evidencia']),
    delete: t.mock.fn(async () => {})
  };
  const bucket = { name: 'evidencias.example.test', file: t.mock.fn(() => file) };
  const admin = {
    credential: { cert: t.mock.fn(() => 'credencial-ficticia') },
    initializeApp: t.mock.fn(() => {}),
    storage: t.mock.fn(() => ({ bucket: t.mock.fn(() => bucket) }))
  };
  replace('firebase-admin', admin);
  t.mock.method(Date, 'now', () => 1700000000000);
  t.mock.method(Math, 'random', () => 0.25);
  return { service: require('../../utils/firebaseStorage'), admin, bucket, file, chunks };
}

describe('Evidencias: Firebase Storage aislado', { concurrency: false }, () => {
  it('sube bytes a un stream en memoria y genera ruta/URL pública', async t => {
    const f = fixture(t);
    const buffer = Buffer.from('contenido de evidencia ficticia');
    const result = await f.service.uploadFileToFirebase(buffer, 'informe final.pdf', 'evidencias/7', 'application/pdf');
    const path = 'evidencias/7/1700000000000-250000000-informe_final.pdf';
    assert.deepEqual(result, { path, fileName: '1700000000000-250000000-informe_final.pdf',
      url: `https://storage.googleapis.com/evidencias.example.test/${path}` });
    assert.deepEqual(Buffer.concat(f.chunks), buffer);
    assert.deepEqual(f.bucket.file.mock.calls[0].arguments, [path]);
    const [options] = f.file.createWriteStream.mock.calls[0].arguments;
    assert.equal(options.metadata.contentType, 'application/pdf');
    assert.equal(options.metadata.metadata.originalName, 'informe final.pdf');
    assert.ok(Number.isFinite(Date.parse(options.metadata.metadata.uploadedAt)));
    assert.equal(options.public, true);
    assert.equal(f.file.makePublic.mock.callCount(), 1);
    assert.deepEqual(f.admin.initializeApp.mock.calls[0].arguments, [{
      credential: 'credencial-ficticia', storageBucket: 'evidencias.example.test'
    }]);
  });
  it('genera URL firmada con acción read y vencimiento solicitado', async t => {
    const f = fixture(t);
    assert.equal(await f.service.getSignedUrl('evidencias/7/informe.pdf', 60000), 'https://signed.example.test/evidencia');
    assert.deepEqual(f.bucket.file.mock.calls[0].arguments, ['evidencias/7/informe.pdf']);
    assert.deepEqual(f.file.getSignedUrl.mock.calls[0].arguments, [{ action: 'read', expires: new Date(1700000060000) }]);
  });
  for (const type of ['uploadError', 'publicError']) it(`propaga ${type} sin devolver URL exitosa`, async t => {
    const error = new Error('fallo de storage simulado');
    const f = fixture(t, { [type]: error });
    await assert.rejects(f.service.uploadFileToFirebase(Buffer.from('test'), 'test.pdf'), error);
    assert.equal(f.file.makePublic.mock.callCount(), type === 'uploadError' ? 0 : 1);
  });
  it('rechaza subida y URL firmada cuando Firebase está deshabilitado', async t => {
    const f = fixture(t);
    f.admin.firebaseEnabled = false;
    await assert.rejects(f.service.uploadFileToFirebase(Buffer.from('test'), 'test.pdf'), /no está configurado/);
    await assert.rejects(f.service.getSignedUrl('test.pdf'), /no está configurado/);
    assert.equal(f.admin.storage.mock.callCount(), 0);
  });
  it('elimina mediante el SDK simulado e ignora un archivo inexistente', async t => {
    const f = fixture(t);
    await f.service.deleteFileFromFirebase('evidencias/test.pdf');
    assert.equal(f.file.delete.mock.callCount(), 1);
    f.file.delete.mock.mockImplementation(async () => { throw Object.assign(new Error('no existe'), { code: 404 }); });
    await f.service.deleteFileFromFirebase('evidencias/test.pdf');
    assert.equal(f.file.delete.mock.callCount(), 2);
  });
});
