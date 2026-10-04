import { createHash } from 'node:crypto';
import { z } from 'zod';

export const enrollmentTables=['enrollments','enrollment_events'];
export const enrollmentSchema=z.object({student_id:z.string().uuid(),class_group_id:z.string().uuid(),level_id:z.string().uuid()}).strict();
export function fail(statusCode){const error=new Error('Erro de matrícula');error.statusCode=statusCode;throw error;}
function administrator(user){if(!['school_admin','platform_admin'].includes(user.role))fail(403);}
const projection=`e.id,e.school_id,e.student_id,s.full_name AS student_name,e.academic_year_id,y.code AS academic_year_code,
  e.class_group_id,g.code AS class_group_code,e.level_id,l.code AS level_code,l.name AS level_name,e.created_at`;
export async function list(client,user,page){
  administrator(user);
  const {rows}=await client.query(`SELECT ${projection} FROM public.enrollments e
    JOIN public.students s ON s.school_id=e.school_id AND s.id=e.student_id
    JOIN public.academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id
    JOIN public.class_groups g ON g.school_id=e.school_id AND g.id=e.class_group_id AND g.academic_year_id=e.academic_year_id
    JOIN public.school_levels l ON l.school_id=e.school_id AND l.id=e.level_id
    WHERE e.school_id=$1 ORDER BY e.created_at,e.id LIMIT 101 OFFSET $2`,[user.school_id,(page-1)*100]);
  return {items:rows.slice(0,100),page,has_more:rows.length>100};
}
export async function create(client,user,data,key){
  administrator(user);
  const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [JSON.stringify(['enrollments',user.school_id,user.id,key])]);
  const {rows:[previous]}=await client.query(`SELECT payload_hash,entity_id FROM public.enrollment_events
    WHERE school_id=$1 AND user_id=$2 AND operation='enrollments' AND request_key=$3`,[user.school_id,user.id,key]);
  if(previous){if(previous.payload_hash!==hash)fail(409);const {rows:[item]}=await client.query(`SELECT ${projection}
    FROM public.enrollments e JOIN public.students s ON s.school_id=e.school_id AND s.id=e.student_id
    JOIN public.academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id
    JOIN public.class_groups g ON g.school_id=e.school_id AND g.id=e.class_group_id AND g.academic_year_id=e.academic_year_id
    JOIN public.school_levels l ON l.school_id=e.school_id AND l.id=e.level_id
    WHERE e.school_id=$1 AND e.id=$2`,[user.school_id,previous.entity_id]);
    if(!item)fail(404);return {item,replayed:true};}
  const {rows:[group]}=await client.query(`SELECT g.academic_year_id FROM public.class_groups g
    JOIN public.class_group_levels gl ON gl.school_id=g.school_id AND gl.class_group_id=g.id AND gl.stage_code=g.stage_code
    JOIN public.school_levels l ON l.school_id=gl.school_id AND l.id=gl.level_id AND l.stage_code=gl.stage_code
    JOIN public.students s ON s.school_id=g.school_id AND s.id=$2
    WHERE g.school_id=$1 AND g.id=$3 AND gl.level_id=$4`,
    [user.school_id,data.student_id,data.class_group_id,data.level_id]);
  if(!group)fail(404);
  const {rows:[item]}=await client.query(`INSERT INTO public.enrollments(school_id,student_id,academic_year_id,class_group_id,level_id)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,[user.school_id,data.student_id,group.academic_year_id,data.class_group_id,data.level_id]);
  await client.query(`INSERT INTO public.enrollment_events(school_id,user_id,operation,request_key,payload_hash,entity_id)
    VALUES($1,$2,'enrollments',$3,$4,$5)`,[user.school_id,user.id,key,hash,item.id]);
  const {rows:[result]}=await client.query(`SELECT ${projection} FROM public.enrollments e
    JOIN public.students s ON s.school_id=e.school_id AND s.id=e.student_id
    JOIN public.academic_years y ON y.school_id=e.school_id AND y.id=e.academic_year_id
    JOIN public.class_groups g ON g.school_id=e.school_id AND g.id=e.class_group_id AND g.academic_year_id=e.academic_year_id
    JOIN public.school_levels l ON l.school_id=e.school_id AND l.id=e.level_id
    WHERE e.school_id=$1 AND e.id=$2`,[user.school_id,item.id]);
  return {item:result,replayed:false};
}
