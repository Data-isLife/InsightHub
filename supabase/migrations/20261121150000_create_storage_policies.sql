
-- =====================================================
-- INSIGHTHUB: STORAGE SECURITY POLICIES
-- =====================================================

-- 1. SELECT: Owners and authorized shared users can download files
create policy "Dataset owners and shared users can download files"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'datasets'
    and exists (
        select 1
        from public.datasets d
        where d.storage_path = storage.objects.name
    )
);

-- 2. INSERT: Users can upload only into their own folders
create policy "Users can upload into their own folders"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and (storage.foldername(name))[2] ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

-- 3. UPDATE: Owners can replace their own files
create policy "Owners can update their own files"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'datasets'
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
    bucket_id = 'datasets'
    and owner_id = (select auth.uid()::text)
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- 4. DELETE: Owners can delete files in their own folders
create policy "Owners can delete files in their own folders"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'datasets'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);
