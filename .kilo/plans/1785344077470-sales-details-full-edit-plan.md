# Plan: Sales Details Page — Full Edit Capability

## Goal
Expand the Sales Details edit dialog from discount-only to full transaction editing (general info, line items, financials) for ADMIN/MANAGER roles, while fixing the discount decomposition bug and improving data integrity.

## Current State
- Edit dialog: customer, payment method, overall discount, loyalty points only
- Backend `TransactionUpdate`: same 4 fields
- `update_transaction` does NOT decompose discount into promotion/manual/loyalty components → breakdown panel becomes stale after edit
- `sale_snapshot` omits critical fields (items, manual_discount, promotion_discount, loyalty_points_redeemed)
- No line item editing; wrong items require void + recreate
- No optimistic concurrency control

## Execution Order

### Phase 1 — Immediate Fixes (do first, low risk)
1. **Fix discount decomposition in `update_transaction`**
   - File: `backend/app/services/sales.py`
   - When `discount` is updated, recalculate `promotion_discount = discount - manual_discount - loyalty_value`
   - Ensure `manual_discount` and `loyalty_points_redeemed` remain consistent with new total discount

2. **Extend `sale_snapshot`**
   - File: `backend/app/services/audit.py`
   - Add: `items` (product_id, quantity, price, discount), `promotion_discount`, `manual_discount`, `loyalty_points_redeemed`, `round_off`, `notes`

3. **Add `notes` field to edit dialog**
   - File: `frontend/src/pages/sales/SaleEditDialog.tsx`
   - Textarea for remarks; wire to backend `notes` field (already supported)

### Phase 2 — Structural Improvements
4. **Extend backend `TransactionUpdate` schema**
   - File: `backend/app/schemas/transaction.py`
   - Add: `notes` (already present but verify), `manual_discount`, `tax`, `round_off`
   - Add nested `TransactionItemUpdate` model: `product_id`, `quantity` (0=remove), `unit_price`, `line_discount`

5. **Implement `reallocate_batches` service**
   - File: `backend/app/services/sales.py`
   - Compare old vs new items, compute stock delta per product
   - Restock removed quantities, deduct added quantities via `deduct_stock_fefo`
   - Preserve batch traceability where possible

6. **Add `version` field to Transaction model**
   - File: `backend/app/models/transaction.py`
   - Add `version: int = Field(default=1)`
   - Use for optimistic concurrency in PATCH handler

7. **Update PATCH handler with optimistic lock**
   - File: `backend/app/routers/transactions.py`
   - Expect `expected_version` in body; fail with 409 if mismatch

8. **Redesign `SaleEditDialog` into tabbed interface**
   - File: `frontend/src/pages/sales/SaleEditDialog.tsx`
   - Tab 1 — General: customer, notes, payment method
   - Tab 2 — Line Items: editable table (qty, price, line discount, remove)
   - Tab 3 — Financials: tax, manual discount, loyalty points, round-off, live preview

9. **Update frontend types and hooks**
   - File: `frontend/src/types/index.ts` — extend `Transaction` if needed
   - File: `frontend/src/hooks/useTransactions.ts` — update `useUpdateTransaction` payload type
   - File: `frontend/src/services/index.ts` — extend `transactionService.update` payload
   - File: `frontend/src/services/mock/mockApi.ts` — update mock to handle new fields

### Phase 3 — Resilience & Polish
10. **Unsaved changes guard**
    - File: `frontend/src/pages/sales/SaleEditDialog.tsx`
    - Warn on close/dialog dismissal when draft differs from original

11. **Change preview panel**
    - Show original vs new totals, stock impact, delta breakdown before save

## Key Design Decisions
- **Scope of line item editing:** quantity, unit price, line discount only. Product substitution requires void + recreate (simplifies batch allocation logic).
- **Discount decomposition:** `manual_discount` is the user-controlled input; `promotion_discount = total_discount - manual_discount - loyalty_value`. If result is negative, clamp and surface warning.
- **Ledger rewrite:** Always rewrite ledger when `total` or `payment_method` changes, regardless of magnitude.
- **Void path remains:** Line item edits do NOT replace void. Void still exists for full reversal.
- **Mock parity:** Frontend mock should mimic backend validation (discount <= subtotal, stock checks) to keep dev experience consistent.

## Validation Plan
- Unit tests for `update_transaction` discount decomposition
- Integration test for line item edit → batch allocation correctness
- Frontend build + typecheck
- Manual smoke test: edit customer, payment, discount, line items, notes; verify breakdown panel, audit log, wallet ledger

## Out of Scope
- Full event sourcing / saga pattern (defer to Phase 3+)
- Coupon/promotion retroactive application
- Undo/redo for edits
- Multi-currency support
