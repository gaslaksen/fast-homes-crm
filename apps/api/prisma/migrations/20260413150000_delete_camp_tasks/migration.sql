-- Delete auto-generated CAMP review tasks that are no longer used
DELETE FROM "tasks" WHERE "title" = 'Review CAMP info and make offer' AND "completed" = false;
