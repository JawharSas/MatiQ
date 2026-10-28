-- =============================================================================
-- MatIQ: `live` match status (recording with incremental analysis).
-- Kept in its own migration: a new enum value cannot be used in the same
-- transaction that adds it.
-- =============================================================================

alter type public.match_status add value if not exists 'live' after 'draft';
