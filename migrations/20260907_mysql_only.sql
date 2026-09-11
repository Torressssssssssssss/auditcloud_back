-- Additive migration. No legacy data is imported; existing IDs and credentials are preserved.
CREATE TABLE IF NOT EXISTS app_sequences (
  entity varchar(64) NOT NULL PRIMARY KEY,
  last_id bigint unsigned NOT NULL
) ENGINE=InnoDB;
ALTER TABLE conversaciones
  ADD COLUMN tipo_conversacion varchar(20) NOT NULL DEFAULT 'COMERCIAL',
  ADD COLUMN id_auditoria int NULL,
  ADD COLUMN id_usuario_supervisor int NULL,
  ADD COLUMN id_usuario_auditor int NULL,
  ADD COLUMN estado varchar(20) NOT NULL DEFAULT 'ABIERTA',
  ADD CONSTRAINT fk_conv_auditoria FOREIGN KEY (id_auditoria) REFERENCES auditorias(id_auditoria),
  ADD CONSTRAINT fk_conv_supervisor FOREIGN KEY (id_usuario_supervisor) REFERENCES usuarios(id_usuario),
  ADD CONSTRAINT fk_conv_auditor FOREIGN KEY (id_usuario_auditor) REFERENCES usuarios(id_usuario);
ALTER TABLE auditorias
  ADD COLUMN creado_por_supervisor int NULL,
  ADD CONSTRAINT fk_audit_creador FOREIGN KEY (creado_por_supervisor) REFERENCES usuarios(id_usuario);
ALTER TABLE solicitudes_pago
  ADD COLUMN mercadopago_payment_id varchar(100) NULL,
  ADD COLUMN id_preferencia varchar(150) NULL,
  ADD COLUMN mercadopago_external_reference varchar(150) NULL,
  ADD COLUMN mercadopago_metadata_id_solicitud_pago varchar(100) NULL,
  ADD COLUMN mercadopago_status varchar(50) NULL,
  ADD COLUMN mercadopago_status_detail varchar(150) NULL,
  ADD COLUMN mercadopago_payment_method_id varchar(100) NULL,
  ADD COLUMN mercadopago_payment_type_id varchar(100) NULL,
  ADD COLUMN mercadopago_transaction_amount decimal(12,2) NULL,
  ADD COLUMN mercadopago_actualizado_en datetime NULL,
  ADD COLUMN mercadopago_preference_created_at datetime NULL,
  ADD UNIQUE KEY uq_mp_payment (mercadopago_payment_id);
ALTER TABLE auditorias
  ADD UNIQUE KEY uq_auditorias_solicitud_pago (id_solicitud_pago);
