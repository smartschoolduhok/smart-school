-- Add missing columns to users and schools tables
-- Required for Step 2 CRUD functionality

-- Add phone to users
ALTER TABLE users ADD COLUMN phone TEXT;

-- Add missing columns to schools
ALTER TABLE schools ADD COLUMN name_en TEXT;
ALTER TABLE schools ADD COLUMN official_stamp_url TEXT;
ALTER TABLE schools ADD COLUMN province TEXT;
ALTER TABLE schools ADD COLUMN address TEXT;
ALTER TABLE schools ADD COLUMN phone TEXT;
ALTER TABLE schools ADD COLUMN email TEXT;
ALTER TABLE schools ADD COLUMN website TEXT;
ALTER TABLE schools ADD COLUMN principal_name TEXT;
