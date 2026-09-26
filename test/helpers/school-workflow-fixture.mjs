import { DatabaseSync } from 'node:sqlite';
import { signJWT } from '../../src/lib/jwtSecurity.ts';
import { LocalD1, fixtureSQL, migrationFiles, migrationSQL, root, snapshot } from './teaching-load-matrix-fixture.mjs';
export { root, snapshot };
export const secret='local-school-workflows-test-secret';
export const tokens=Object.fromEntries(await Promise.all(Object.entries({owner:'owner',admin:'admin',teacher:'teacher',registrar:'registrar',accountant:'accountant',parent:'parent',otherParent:'other-parent',foreignParent:'foreign-parent'}).map(async([key,name])=>[key,await signJWT({email:`${name}@matrix.test`,auth_version:1},secret)])));
export {fixtureSQL as baseFixtureSQL,migrationFiles};
export const schoolWorkflowFixtureSQL=`
 INSERT INTO users(id,school_id,full_name,email,role_id,status,auth_version) VALUES
 (8,1,'Parent','parent@matrix.test',8,'active',1),(9,1,'Other Parent','other-parent@matrix.test',8,'active',1),(10,2,'Foreign Parent','foreign-parent@matrix.test',8,'active',1);
 INSERT INTO teacher_employee_links(school_id,teacher_user_id,employee_id,status,created_by_user_id) VALUES(1,3,2,'active',1);
 INSERT INTO students(id,school_id,student_number,full_name,gender,class_id,section_id,status) VALUES
 (101,1,'S101','Student A','male',1,2,'active'),(102,1,'S102','Student B','female',1,2,'active'),(103,2,'S103','Foreign Student','male',3,3,'active');
 INSERT INTO student_enrollments(school_id,student_id,academic_year_id,class_id,section_id,status,promotion_status,created_by_user_id) VALUES
 (1,101,1,1,2,'active','pending',1),(1,102,1,1,2,'active','pending',1),(2,103,3,3,3,'active','pending',2);
 INSERT INTO student_subjects(school_id,student_id,subject_id,class_id,section_id,is_active,assigned_by_user_id) VALUES
 (1,101,1,1,2,1,1),(1,102,2,1,2,1,1),(2,103,5,3,3,1,2);
 INSERT INTO parent_student_links(school_id,parent_user_id,student_id,status,created_by_user_id) VALUES(1,8,101,'active',1),(1,9,102,'active',1),(2,10,103,'active',2);
`;
export function fixture(t) {
 const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); t.after(()=>db.close());
 for(const file of migrationFiles) db.exec(migrationSQL(file)); db.exec(fixtureSQL);
 db.exec(schoolWorkflowFixtureSQL);
 return {db,d1:new LocalD1(db)};
}
export async function request(app,f,role,method,path,body) {
 const r=await app.request(`http://localhost${path}`,{method,headers:{Authorization:`Bearer ${tokens[role]}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:f.d1,JWT_SECRET:secret,APP_ENV:'test'});
 return {status:r.status,...await r.json()};
}
