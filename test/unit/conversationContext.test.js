const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  inferConversationType,
  normalizeConversation,
  isCommercialConversation,
  isAuditConversation
} = require('../../utils/conversationContext');

describe('inferConversationType', () => {
  it('respeta tipo_conversacion aunque exista id_auditoria', () => {
    assert.equal(inferConversationType({ tipo_conversacion: 'COMERCIAL', id_auditoria: 42 }), 'COMERCIAL');
    assert.equal(inferConversationType({ tipo_conversacion: 'AUDITORIA' }), 'AUDITORIA');
  });

  it('infiere AUDITORIA cuando id_auditoria existe, incluido cero', () => {
    for (const id_auditoria of [42, 0]) {
      assert.equal(inferConversationType({ id_auditoria }), 'AUDITORIA');
    }
  });

  it('infiere COMERCIAL sin tipo ni ID de auditoría', () => {
    assert.equal(inferConversationType(), 'COMERCIAL');
    assert.equal(inferConversationType({}), 'COMERCIAL');
    for (const value of [null, undefined]) {
      assert.equal(inferConversationType({ tipo_conversacion: value, id_auditoria: value }), 'COMERCIAL');
    }
  });

  it('infiere el tipo si tipo_conversacion es nulo, indefinido o vacío', () => {
    for (const tipo_conversacion of [null, undefined, '']) {
      assert.equal(inferConversationType({ tipo_conversacion, id_auditoria: 42 }), 'AUDITORIA');
    }
  });
});

describe('normalizeConversation', () => {
  const idPairs = [
    ['id_empresa_auditora', 'id_empresa'],
    ['id_cliente', 'id_usuario_cliente'],
    ['id_supervisor', 'id_usuario_supervisor'],
    ['id_auditor', 'id_usuario_auditor']
  ];

  for (const [primary, fallback] of idPairs) {
    it(`prioriza ${primary} sobre ${fallback} y sincroniza ambos`, () => {
      const result = normalizeConversation({ [primary]: 10, [fallback]: 20 });
      assert.equal(result[primary], 10);
      assert.equal(result[fallback], 10);
    });

    it(`usa ${fallback} cuando ${primary} está ausente, es nulo o indefinido`, () => {
      for (const input of [
        { [fallback]: 20 },
        { [primary]: null, [fallback]: 20 },
        { [primary]: undefined, [fallback]: 20 }
      ]) {
        const result = normalizeConversation(input);
        assert.equal(result[primary], 20);
        assert.equal(result[fallback], 20);
      }
    });

    it(`normaliza ${primary} y ${fallback} a null si no tienen valor`, () => {
      for (const primaryValue of [null, undefined]) {
        for (const fallbackValue of [null, undefined]) {
          const result = normalizeConversation({ [primary]: primaryValue, [fallback]: fallbackValue });
          assert.equal(result[primary], null);
          assert.equal(result[fallback], null);
        }
      }
    });

    it(`conserva cero en ${primary} y en ${fallback}`, () => {
      for (const input of [
        { [primary]: 0, [fallback]: 20 },
        { [primary]: null, [fallback]: 0 }
      ]) {
        const result = normalizeConversation(input);
        assert.equal(result[primary], 0);
        assert.equal(result[fallback], 0);
      }
    });
  }

  it('normaliza una conversación vacía o un argumento omitido', () => {
    const expected = {
      tipo_conversacion: 'COMERCIAL',
      id_empresa: null,
      id_empresa_auditora: null,
      id_cliente: null,
      id_usuario_cliente: null,
      id_supervisor: null,
      id_usuario_supervisor: null,
      id_auditor: null,
      id_usuario_auditor: null,
      id_auditoria: null,
      estado: 'ABIERTA'
    };
    assert.deepEqual(normalizeConversation(), expected);
    assert.deepEqual(normalizeConversation({}), expected);
  });

  it('normaliza id_auditoria nulo o indefinido y conserva IDs existentes', () => {
    for (const id_auditoria of [null, undefined, 0, 42]) {
      const result = normalizeConversation({ id_auditoria });
      assert.equal(result.id_auditoria, id_auditoria ?? null);
      assert.equal(result.tipo_conversacion, id_auditoria == null ? 'COMERCIAL' : 'AUDITORIA');
    }
  });

  it('respeta el tipo explícito durante la normalización', () => {
    const result = normalizeConversation({ tipo_conversacion: 'COMERCIAL', id_auditoria: 42 });
    assert.equal(result.tipo_conversacion, 'COMERCIAL');
    assert.equal(result.id_auditoria, 42);
  });

  it('respeta estado aunque contradiga activo', () => {
    assert.equal(normalizeConversation({ estado: 'ABIERTA', activo: false }).estado, 'ABIERTA');
    assert.equal(normalizeConversation({ estado: 'CERRADA', activo: true }).estado, 'CERRADA');
    assert.equal(normalizeConversation({ estado: 'PENDIENTE' }).estado, 'PENDIENTE');
  });

  it('usa CERRADA solo cuando activo es estrictamente false y falta estado', () => {
    for (const estado of [null, undefined, '']) {
      assert.equal(normalizeConversation({ estado, activo: false }).estado, 'CERRADA');
    }
  });

  it('usa ABIERTA por defecto para cualquier otro valor de activo', () => {
    for (const activo of [true, null, undefined, 0, '', 'false']) {
      for (const estado of [null, undefined, '']) {
        assert.equal(normalizeConversation({ estado, activo }).estado, 'ABIERTA');
      }
    }
  });

  it('preserva propiedades adicionales y no modifica el objeto original', () => {
    const input = Object.freeze({ id_empresa: 20, asunto: 'Consulta', activo: false });
    const result = normalizeConversation(input);
    assert.notStrictEqual(result, input);
    assert.equal(result.asunto, 'Consulta');
    assert.equal(result.activo, false);
    assert.deepEqual(input, { id_empresa: 20, asunto: 'Consulta', activo: false });
  });
});

describe('isCommercialConversation e isAuditConversation', () => {
  const cases = [
    ['argumento omitido', undefined, true, false],
    ['conversación vacía', {}, true, false],
    ['tipo comercial explícito con auditoría', { tipo_conversacion: 'COMERCIAL', id_auditoria: 42 }, true, false],
    ['tipo auditoría explícito sin ID', { tipo_conversacion: 'AUDITORIA' }, false, true],
    ['auditoría inferida', { id_auditoria: 42 }, false, true],
    ['auditoría con ID cero', { id_auditoria: 0 }, false, true],
    ['ID nulo', { id_auditoria: null }, true, false],
    ['ID indefinido', { id_auditoria: undefined }, true, false],
    ['tipo desconocido', { tipo_conversacion: 'OTRO', id_auditoria: 42 }, false, false]
  ];

  for (const [name, input, commercial, audit] of cases) {
    it(name, () => {
      assert.equal(isCommercialConversation(input), commercial);
      assert.equal(isAuditConversation(input), audit);
    });
  }
});
