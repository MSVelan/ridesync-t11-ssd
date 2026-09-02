

CREATE TABLE wallet_audit_logs (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rider_id INT NOT NULL REFERENCES riders(id),
    amount_changed DECIMAL(10,2) NOT NULL,
    action_type VARCHAR(10) NOT NULL
        CHECK (action_type IN ('CREDIT', 'DEBIT')),
    balance_after DECIMAL(10,2) NOT NULL
        CHECK (balance_after >= 0.00),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);