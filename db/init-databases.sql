select 'create database evogo_auth'
where not exists (select from pg_database where datname = 'evogo_auth')\gexec

select 'create database evogo_users'
where not exists (select from pg_database where datname = 'evogo_users')\gexec

select 'create database inovalot_panel'
where not exists (select from pg_database where datname = 'inovalot_panel')\gexec
