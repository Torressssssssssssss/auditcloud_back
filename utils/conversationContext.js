function inferConversationType(conversation = {}) {
  if (conversation.tipo_conversacion) {
    return conversation.tipo_conversacion;
  }

  if (conversation.id_auditoria !== undefined && conversation.id_auditoria !== null) {
    return 'AUDITORIA';
  }

  return 'COMERCIAL';
}

function normalizeConversation(conversation = {}) {
  const tipoConversacion = inferConversationType(conversation);
  const idEmpresaAuditora = conversation.id_empresa_auditora ?? conversation.id_empresa ?? null;
  const idCliente = conversation.id_cliente ?? conversation.id_usuario_cliente ?? null;
  const idSupervisor = conversation.id_supervisor ?? conversation.id_usuario_supervisor ?? null;
  const idAuditor = conversation.id_auditor ?? conversation.id_usuario_auditor ?? null;
  const idAuditoria = conversation.id_auditoria ?? null;

  return {
    ...conversation,
    tipo_conversacion: tipoConversacion,
    id_empresa: idEmpresaAuditora,
    id_empresa_auditora: idEmpresaAuditora,
    id_cliente: idCliente,
    id_usuario_cliente: idCliente,
    id_supervisor: idSupervisor,
    id_usuario_supervisor: idSupervisor,
    id_auditor: idAuditor,
    id_usuario_auditor: idAuditor,
    id_auditoria: idAuditoria,
    estado: conversation.estado || (conversation.activo === false ? 'CERRADA' : 'ABIERTA')
  };
}

function isCommercialConversation(conversation = {}) {
  return inferConversationType(conversation) === 'COMERCIAL';
}

function isAuditConversation(conversation = {}) {
  return inferConversationType(conversation) === 'AUDITORIA';
}

module.exports = {
  inferConversationType,
  normalizeConversation,
  isCommercialConversation,
  isAuditConversation
};