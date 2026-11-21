
-- =====================================================
-- INSIGHTHUB: INITIAL DATASET DATABASE MIGRATION
-- =====================================================


-- 1. Create a private schema for internal database functions.
-- This schema is not intended to be exposed through the Data API.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

grant usage on schema private to authenticated;


-- =====================================================
-- 2. DATASETS TABLE
-- =====================================================

create table public.datasets (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        default auth.uid()
        references auth.users(id)
        on delete cascade,

    name text not null
        check (char_length(btrim(name)) between 1 and 100),

    description text
        check (description is null or char_length(description) <= 1000),

    file_name text not null
        check (char_length(file_name) between 1 and 255),

    file_type text not null
        check (file_type in ('CSV', 'XLSX')),

    file_size bigint not null
        check (file_size > 0),

    storage_path text not null unique,

    row_count bigint
        check (row_count is null or row_count >= 0),

    column_count integer
        check (column_count is null or column_count >= 0),

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);


-- =====================================================
-- 3. DATASET SHARES TABLE
-- =====================================================

create table public.dataset_shares (
    id uuid primary key default gen_random_uuid(),

    dataset_id uuid not null
        references public.datasets(id)
        on delete cascade,

    shared_with_user_id uuid not null
        references auth.users(id)
        on delete cascade,

    role text not null default 'viewer'
        check (role in ('viewer', 'editor')),

    created_by uuid not null default auth.uid()
        references auth.users(id)
        on delete cascade,

    created_at timestamptz not null default now(),

    constraint unique_dataset_share
        unique (dataset_id, shared_with_user_id)
);


-- =====================================================
-- 4. INDEXES
-- =====================================================

create index datasets_user_id_idx
    on public.datasets(user_id);

create index datasets_created_at_idx
    on public.datasets(created_at desc);

create index dataset_shares_recipient_idx
    on public.dataset_shares(shared_with_user_id);


-- =====================================================
-- 5. AUTOMATIC UPDATED_AT TIMESTAMP
-- =====================================================

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger set_datasets_updated_at
before update on public.datasets
for each row
execute function private.set_updated_at();


-- =====================================================
-- 6. SECURITY HELPER FUNCTIONS
-- =====================================================

-- Checks whether the current user owns a dataset.

create function private.owns_dataset(_dataset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.datasets d
        where d.id = _dataset_id
          and d.user_id = (select auth.uid())
    );
$$;


-- Checks whether the current user can view a dataset.

create function private.can_view_dataset(_dataset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        private.owns_dataset(_dataset_id)
        or exists (
            select 1
            from public.dataset_shares s
            where s.dataset_id = _dataset_id
              and s.shared_with_user_id = (select auth.uid())
        );
$$;


-- Checks whether the current user can edit a dataset.

create function private.can_edit_dataset(_dataset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        private.owns_dataset(_dataset_id)
        or exists (
            select 1
            from public.dataset_shares s
            where s.dataset_id = _dataset_id
              and s.shared_with_user_id = (select auth.uid())
              and s.role = 'editor'
        );
$$;


-- Restrict execution of security helper functions.

revoke all on function private.owns_dataset(uuid) from public, anon;
revoke all on function private.can_view_dataset(uuid) from public, anon;
revoke all on function private.can_edit_dataset(uuid) from public, anon;

grant execute on function private.owns_dataset(uuid) to authenticated;
grant execute on function private.can_view_dataset(uuid) to authenticated;
grant execute on function private.can_edit_dataset(uuid) to authenticated;


-- =====================================================
-- 7. ENABLE ROW LEVEL SECURITY
-- =====================================================

alter table public.datasets enable row level security;

alter table public.dataset_shares enable row level security;


-- =====================================================
-- 8. CONTROL DATABASE PRIVILEGES
-- =====================================================

revoke all on table public.datasets from anon, authenticated;

grant select, delete
    on public.datasets
    to authenticated;

-- Users may insert metadata but cannot choose their owner ID,
-- creation timestamps, or processing statistics.

grant insert (
    name,
    description,
    file_name,
    file_type,
    file_size,
    storage_path
)
on public.datasets
to authenticated;

-- Owners and editors can update only these two columns.

grant update (
    name,
    description
)
on public.datasets
to authenticated;


revoke all on table public.dataset_shares from anon, authenticated;

grant select, delete
    on public.dataset_shares
    to authenticated;

grant insert (
    dataset_id,
    shared_with_user_id,
    role
)
on public.dataset_shares
to authenticated;

grant update (role)
    on public.dataset_shares
    to authenticated;


-- =====================================================
-- 9. DATASET SECURITY POLICIES
-- =====================================================

-- Owners and explicitly shared users can view datasets.

create policy "Dataset owners and recipients can view datasets"
on public.datasets
for select
to authenticated
using (
    (select private.can_view_dataset(id))
);


-- A user can only create datasets belonging to themselves.

create policy "Users can create their own datasets"
on public.datasets
for insert
to authenticated
with check (
    user_id = (select auth.uid())
);


-- Owners and editors can update permitted dataset fields.

create policy "Owners and editors can update datasets"
on public.datasets
for update
to authenticated
using (
    (select private.can_edit_dataset(id))
)
with check (
    (select private.can_edit_dataset(id))
);


-- Only the owner can delete a dataset record.

create policy "Only owners can delete datasets"
on public.datasets
for delete
to authenticated
using (
    (select private.owns_dataset(id))
);


-- =====================================================
-- 10. SHARING SECURITY POLICIES
-- =====================================================

-- Owners see all shares they manage.
-- Recipients can see their own share record.

create policy "Owners and recipients can view shares"
on public.dataset_shares
for select
to authenticated
using (
    (select private.owns_dataset(dataset_id))
    or shared_with_user_id = (select auth.uid())
);


-- Only the owner can grant access to another user.

create policy "Only owners can share datasets"
on public.dataset_shares
for insert
to authenticated
with check (
    (select private.owns_dataset(dataset_id))
    and created_by = (select auth.uid())
    and shared_with_user_id <> (select auth.uid())
);


-- Only the owner can change a recipient's role.

create policy "Only owners can update sharing permissions"
on public.dataset_shares
for update
to authenticated
using (
    (select private.owns_dataset(dataset_id))
)
with check (
    (select private.owns_dataset(dataset_id))
);


-- Only the owner can revoke sharing permissions.

create policy "Only owners can revoke sharing permissions"
on public.dataset_shares
for delete
to authenticated
using (
    (select private.owns_dataset(dataset_id))
);
