-- Add missing columns to users and schools tables
-- Required for Step 2 CRUD functionality
-- NOTE: schools profile columns (name_en, official_stamp_url, province, address,
-- phone, email, website, principal_name) are already added in migration 0011.
-- This migration only adds users.phone which is needed for user CRUD.

-- Add phone to users
ALTER TABLE users ADD COLUMN phone TEXT;
