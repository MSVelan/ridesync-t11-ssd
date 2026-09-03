CREATE OR REPLACE FUNCTION log_wallet_change()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO wallet_audit_logs (
        rider_id,
        amount_changed,
        action_type,
        balance_after
    )
    VALUES (
        NEW.id,
        NEW.wallet_balance - OLD.wallet_balance,
        CASE
            WHEN NEW.wallet_balance > OLD.wallet_balance THEN 'CREDIT'
            ELSE 'DEBIT'
        END,
        NEW.wallet_balance
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE TRIGGER trg_rider_wallet_audit
AFTER UPDATE OF wallet_balance ON riders
FOR EACH ROW
WHEN (OLD.wallet_balance IS DISTINCT FROM NEW.wallet_balance)
EXECUTE FUNCTION log_wallet_change();