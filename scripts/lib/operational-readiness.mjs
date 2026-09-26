// Read-only operational diagnosis. No student names, tokens, grades or passwords.
export async function collectOperationalReadiness(read, asOfDate) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))throw new Error('Explicit ISO date is required');
 const schools=await read('SELECT id AS school_id,name,city,status FROM schools ORDER BY id');
 const viewNames=(await read("SELECT name FROM sqlite_schema WHERE type='view' AND name LIKE '%_readiness' ORDER BY name")).map(r=>r.name);
 const readiness={};for(const name of viewNames){if(!/^[a-z_]+$/.test(name))throw new Error('Unexpected view name');readiness[name]=await read(`SELECT * FROM "${name}" ORDER BY school_id`);}
 const cardCases=await read(`SELECT card.id AS result_card_id,card.school_id,card.academic_year_id,card.class_id,
  card.status,card.publication_status,card.publication_revision,
  CASE WHEN card.publication_status='draft' AND card.status='cancelled' AND card.publication_revision=0
    AND card.published_at IS NULL AND card.published_by_user_id IS NULL AND card.withdrawn_at IS NULL
    AND card.withdrawn_by_user_id IS NULL AND card.withdrawal_reason IS NULL
    AND NOT EXISTS(SELECT 1 FROM result_card_publication_logs h WHERE h.result_card_id=card.id)
   THEN 'valid_unpublished_cancellation' ELSE 'inconsistent_requires_review' END AS diagnosis
  FROM result_cards card WHERE (card.publication_status='draft' AND card.status<>'active')
   OR (card.publication_status='published' AND card.status<>'active')
   OR (card.publication_status='withdrawn' AND card.status<>'cancelled') ORDER BY card.school_id,card.id`);
 const policyCoverage=await read(`SELECT c.school_id,y.id AS academic_year_id,c.id AS class_id,c.name AS class_name,
  p.id AS current_policy_id,p.status AS current_status,p.source_reference,
  CASE WHEN y.id IS NULL THEN 'no_active_year' WHEN p.id IS NULL THEN 'missing_policy'
   WHEN p.status='draft' THEN 'draft_requires_approval'
   WHEN length(trim(coalesce(p.source_reference,'')))=0 THEN 'missing_source'
   ELSE 'configured_source_requires_operator_verification' END AS diagnosis
  FROM classes c JOIN schools s ON s.id=c.school_id AND s.status='active'
  LEFT JOIN academic_years y ON y.school_id=c.school_id AND y.is_active=1
  LEFT JOIN academic_grade_policies p ON p.school_id=c.school_id AND p.academic_year_id=y.id AND p.class_id=c.id AND p.is_current=1
  WHERE c.status='active' ORDER BY c.school_id,y.id,c.id`);
 const regulationCoverage=await read(`SELECT c.school_id,y.id AS academic_year_id,c.id AS class_id,c.name AS class_name,processes.process,
  r.id AS regulation_id,r.jurisdiction,r.source_reference,r.effective_from,r.effective_to,
  CASE WHEN y.id IS NULL THEN 'no_active_year' WHEN r.id IS NULL THEN 'missing_approved_regulation'
   WHEN '${asOfDate}'<r.effective_from THEN 'not_yet_effective' WHEN '${asOfDate}'>r.effective_to THEN 'expired'
   ELSE 'configured_source_requires_operator_verification' END AS diagnosis
  FROM classes c JOIN schools s ON s.id=c.school_id AND s.status='active'
  CROSS JOIN (SELECT 'admission' AS process UNION ALL SELECT 'transfer_in' UNION ALL SELECT 'transfer_out') processes
  LEFT JOIN academic_years y ON y.school_id=c.school_id AND y.is_active=1
  LEFT JOIN admission_regulations r ON r.school_id=c.school_id AND r.academic_year_id=y.id AND r.class_id=c.id
   AND r.process=processes.process AND r.status='approved'
  WHERE c.status='active' ORDER BY c.school_id,y.id,c.id,processes.process`);
 const migrationHistory=await read('SELECT name FROM d1_migrations ORDER BY id');
 const foreignKeys=await read('PRAGMA foreign_key_check');
 return {read_only:true,as_of_date:asOfDate,schools,migration_history:migrationHistory,foreign_key_check:foreignKeys,
  readiness,result_card_cases:cardCases,grade_policy_coverage:policyCoverage,regulation_coverage:regulationCoverage,
  official_sources_verified:false,pilot_completed:false,production_ready:false,
  summary:{foreign_key_violations:foreignKeys.length,valid_unpublished_cancellations:cardCases.filter(r=>r.diagnosis==='valid_unpublished_cancellation').length,
   inconsistent_cards:cardCases.filter(r=>r.diagnosis==='inconsistent_requires_review').length,
   grade_policy_gaps:policyCoverage.filter(r=>r.diagnosis!=='configured_source_requires_operator_verification').length,
   regulation_gaps:regulationCoverage.filter(r=>r.diagnosis!=='configured_source_requires_operator_verification').length}};
}
