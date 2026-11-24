-- ---------------------------------------------------------------------
-- 0015 Events default their actor to the signed-in user (service-role writes stay null),
-- so every event a member's action writes passes the "actor is you" insert policy.
-- ---------------------------------------------------------------------
alter table desk.events alter column actor_id set default auth.uid();

-- Two more audit actions for account changes made in Settings.
alter table desk.audit_log drop constraint audit_log_action_check;
alter table desk.audit_log add constraint audit_log_action_check check (action in (
  'create', 'update', 'delete',
  'sign_in', 'sign_in_failed', 'sign_in_locked', 'sign_out',
  'mfa_enrolled', 'mfa_verified', 'mfa_failed', 'mfa_removed', 'password_changed', 'session_expired',
  'export', 'forget', 'import'));
