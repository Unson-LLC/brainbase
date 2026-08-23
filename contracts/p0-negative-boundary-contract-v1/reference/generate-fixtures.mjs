import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const effects = {database:0,organization_event:0,graph:0,search:0,llm:0,credential:0,external:0,deploy:0};
export const CANONICAL_BASELINE = {
  authority:{owner_consent:true,organization_acceptance:true,capability_id:'personal_to_organization.promote',allowed_effects:['organization_event'],resource_ref:'synthetic-personal-record-a',decision:'approval',owner_person_id:'synthetic-person-a',reviewer_person_id:'synthetic-person-b',revisions:{policy:7,raci:5,resource:3,tenant:11,connection:13,membership:17},expires_at:'2099-01-01T00:00:00.000Z',integrity:'valid',freshness:'current',replayed:false},
  provider:'slack',audience:'mana-runtime',
  request:{capability_id:'personal_to_organization.promote',desired_effect:'organization_event',resource_ref:'synthetic-personal-record-a',correlation_id:'corr-p0-001',operation_id:'op-p0-001',idempotency_key:'idem-p0-001',source_tenant:'synthetic-tenant-a',target_tenant:'synthetic-tenant-a',source_person:'synthetic-person-a',target_person:'synthetic-person-a',person_resolution:'active_exact',ingress:'mana-runtime'},
  receipt:{correlation_id:'corr-p0-001',operation_id:'op-p0-001',idempotency_key:'idem-p0-001'},
  bindings:{request_subject:'U-SYNTH-A',actor_external_subject:'U-SYNTH-A',tenant_actor_subject:'U-SYNTH-A',canonical_person:'synthetic-person-a',tenant_principal:'synthetic-person-a',requested_organization:'synthetic-tenant-a',authorized_organization:'synthetic-tenant-a',requested_project:'synthetic-project-a',authorized_project:'synthetic-project-a',placement:'synthetic-placement-a',deployment:'synthetic-placement-a',request_workspace:'W-SYNTH-A',context_workspace:'W-SYNTH-A',request_app:'A-SYNTH-A',context_app:'A-SYNTH-A',request_enterprise:'E-SYNTH-A',context_enterprise:'E-SYNTH-A',request_channel:'C-SYNTH-A',context_channel:'C-SYNTH-A',request_thread:'1700000000.000001',context_thread:'1700000000.000001',request_event:'EV-SYNTH-A',context_event:'EV-SYNTH-A'},
  privacy:{organization_reviewer_can_view_personal_body:false,graph_personal_body:'absent',search_personal_body:'absent',event_personal_body:'absent',receipt_personal_body:'absent',llm_is_promotion_authority:false}
};

export const CASE_DEFINITIONS = [
 ['NEG-CROSS-PERSON-A-B','cross_person','/request/target_person','synthetic-person-b','tenant_person_isolation','request'],
 ['NEG-CROSS-PERSON-B-A','cross_person','/request/source_person','synthetic-person-b','tenant_person_isolation','request'],
 ['NEG-CROSS-ORG-A-B','cross_organization','/request/target_tenant','synthetic-tenant-b','tenant_isolation','request'],
 ['NEG-CROSS-ORG-B-A','cross_organization','/request/source_tenant','synthetic-tenant-b','tenant_isolation','request'],
 ['NEG-OWNER-APPROVAL-ALONE','dual_authority','/authority/organization_acceptance',false,'dual_authority_required','authority'],
 ['NEG-REVIEWER-PERSONAL-BODY','privacy','/privacy/organization_reviewer_can_view_personal_body',true,'personal_body_non_visibility','privacy'],
 ['NEG-GRAPH-RECONSTRUCTION','privacy','/privacy/graph_personal_body','semantic_canary','personal_body_non_reconstruction','graph'],
 ['NEG-SEARCH-RECONSTRUCTION','privacy','/privacy/search_personal_body','reconstructed','personal_body_non_reconstruction','search'],
 ['NEG-EVENT-RECONSTRUCTION','privacy','/privacy/event_personal_body','reconstructed','personal_body_non_reconstruction','organization_event'],
 ['NEG-RECEIPT-RECONSTRUCTION','privacy','/privacy/receipt_personal_body','reconstructed','personal_body_non_reconstruction','receipt'],
 ['NEG-LLM-REPETITION','llm_non_authority','/privacy/llm_is_promotion_authority',true,'llm_repetition_is_not_authority','llm'],
 ['NEG-OWNER-REVIEWER-SAME','dual_authority','/authority/reviewer_person_id','synthetic-person-a','separate_authorities','authority'],
 ['NEG-PERSON-UNKNOWN','identity','/request/person_resolution','unknown','canonical_person_active_exact','identity'],
 ['NEG-PERSON-MISSING','identity','/request/person_resolution','missing','canonical_person_active_exact','identity'],
 ['NEG-PERSON-AMBIGUOUS','identity','/request/person_resolution','ambiguous','canonical_person_active_exact','identity'],
 ['NEG-PERSON-INACTIVE','identity','/request/person_resolution','inactive','canonical_person_active_exact','identity'],
 ['NEG-PERSON-MERGED','identity','/request/person_resolution','merged','canonical_person_active_exact','identity'],
 ['NEG-AUTHORITY-CAPABILITY','authority_binding','/request/capability_id','promotion.other','authority_capability_binding','authority'],
 ['NEG-AUTHORITY-EFFECT','authority_binding','/request/desired_effect','graph_write','authority_effect_binding','authority'],
 ['NEG-AUTHORITY-RESOURCE','authority_binding','/request/resource_ref','synthetic-personal-record-b','authority_resource_binding','authority'],
 ['NEG-AUTHORITY-DECISION','authority_binding','/authority/decision','auto','human_decision_required','authority'],
 ['NEG-AUTHORITY-ACTOR','authority_binding','/authority/reviewer_person_id','synthetic-person-c','authority_actor_binding','authority'],
 ['NEG-AUTHORITY-REVISION','authority_binding','/authority/revisions/policy',8,'authority_revision_binding','authority'],
 ['NEG-AUTHORITY-EXPIRY','authority_binding','/authority/expires_at','2000-01-01T00:00:00.000Z','authority_not_expired','authority'],
 ['NEG-AUTHORITY-INTEGRITY','authority_binding','/authority/integrity','invalid','authority_integrity','authority'],
 ['NEG-AUTHORITY-STALE','authority_binding','/authority/freshness','stale','authority_freshness','authority'],
 ['NEG-AUTHORITY-REPLAY','authority_binding','/authority/replayed',true,'authority_not_replayed','authority'],
 ['NEG-PROVIDER','ingress','/provider','teams','provider_slack','provider'],
 ['NEG-AUDIENCE','ingress','/audience','brainbase','audience_mana_runtime','audience'],
 ['NEG-CORRELATION','request_receipt_binding','/receipt/correlation_id','corr-p0-other','correlation_binding','receipt'],
 ['NEG-OPERATION','request_receipt_binding','/receipt/operation_id','op-p0-other','operation_binding','receipt'],
 ['NEG-IDEMPOTENCY','request_receipt_binding','/receipt/idempotency_key','idem-p0-other','idempotency_binding','receipt'],
 ['NEG-BIND-SUBJECT','cross_layer_binding','/bindings/actor_external_subject','U-SYNTH-B','binding_request_subject','cross_layer'],
 ['NEG-BIND-ACTOR-SUBJECT','cross_layer_binding','/bindings/tenant_actor_subject','U-SYNTH-B','binding_actor_subject','cross_layer'],
 ['NEG-BIND-PRINCIPAL','cross_layer_binding','/bindings/tenant_principal','synthetic-person-b','binding_principal','cross_layer'],
 ['NEG-BIND-ORG','cross_layer_binding','/bindings/authorized_organization','synthetic-tenant-b','binding_organization','cross_layer'],
 ['NEG-BIND-PROJECT','cross_layer_binding','/bindings/authorized_project','synthetic-project-b','binding_project','cross_layer'],
 ['NEG-BIND-PLACEMENT','cross_layer_binding','/bindings/deployment','synthetic-placement-b','binding_placement','cross_layer'],
 ['NEG-BIND-WORKSPACE','cross_layer_binding','/bindings/context_workspace','W-SYNTH-B','binding_workspace','cross_layer'],
 ['NEG-BIND-APP','cross_layer_binding','/bindings/context_app','A-SYNTH-B','binding_app','cross_layer'],
 ['NEG-BIND-ENTERPRISE','cross_layer_binding','/bindings/context_enterprise','E-SYNTH-B','binding_enterprise','cross_layer'],
 ['NEG-BIND-CHANNEL','cross_layer_binding','/bindings/context_channel','C-SYNTH-B','binding_channel','cross_layer'],
 ['NEG-BIND-THREAD','cross_layer_binding','/bindings/context_thread','1700000000.000002','binding_thread','cross_layer'],
 ['NEG-BIND-EVENT','cross_layer_binding','/bindings/context_event','EV-SYNTH-B','binding_event','cross_layer'],
 ['NEG-DIRECT-WEB','unsupported_ingress','/request/ingress','brainbase-web','mana_runtime_only_ingress','ingress'],
 ['NEG-DIRECT-SERVICE','unsupported_ingress','/request/ingress','brainbase-service','mana_runtime_only_ingress','ingress'],
 ['NEG-DIRECT-API','unsupported_ingress','/request/ingress','brainbase-api','mana_runtime_only_ingress','ingress'],
 ['NEG-DIRECT-UI','unsupported_ingress','/request/ingress','brainbase-ui','mana_runtime_only_ingress','ingress'],
 ['NEG-DIRECT-LEGACY','unsupported_ingress','/request/ingress','brainbase-legacy','mana_runtime_only_ingress','ingress']
];
const at = (obj,path) => path.slice(1).split('/').reduce((v,key)=>v[key],obj);
export function buildBundle() {
  const negative_cases = CASE_DEFINITIONS.map(([id,category,path,after,invariant,surface])=>({id,category,mutation:{mode:'single',path,before:at(CANONICAL_BASELINE,path),after},expected:{decision:'deny',violated_invariant:invariant,surface,effects}}));
  return {schema_version:'1.1',contract_id:'p0-negative-boundary-contract-v1',synthetic_data_only:true,canonical_baseline:CANONICAL_BASELINE,inventory:{tenants:['synthetic-tenant-a','synthetic-tenant-b'],persons:['synthetic-person-a','synthetic-person-b'],required_case_ids:negative_cases.map(x=>x.id),effect_counters:Object.keys(effects)},negative_cases,evidence_state:{contract:'collected',runtime:'not_collected',production:'not_collected'}};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(resolve(import.meta.dirname,'../fixtures/cases.json'),`${JSON.stringify(buildBundle(),null,2)}\n`);
}
