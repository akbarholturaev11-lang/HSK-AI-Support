import test from "node:test";
import assert from "node:assert/strict";
import {isReportedIssueContinuation} from "../src/ai.js";

const history=[
 {role:"user",content:"Reported HSK AI bug: Lava checkout тўлов хизмати жавоб бермаяпти."},
 {role:"assistant",content:"Тўлов хизмати жавоб бермаяпти. Хатолик ҳақида мутахассисларга хабар бердим. Улар муаммони тезда кўриб чиқишади."}
];

test("short Uzbek unresolved follow-ups stay tied to a previously acknowledged report",()=>{
 for(const query of ["Холиям тузалмади","Ҳолиям тузалмади","Ҳали ҳам тузалмади","Барибир ишламаяпти"]){
  assert.equal(isReportedIssueContinuation(query,history),true,query);
 }
});

test("status follow-up is not invented without an acknowledged specialist report",()=>{
 assert.equal(isReportedIssueContinuation("Холиям тузалмади",[]),false);
 assert.equal(isReportedIssueContinuation("Холиям тузалмади",[
  {role:"user",content:"Хатолик ҳақида мутахассисларга хабар бердим"}]),false);
 assert.equal(isReportedIssueContinuation("Холиям тузалмади",[
  {role:"assistant",content:"Билимлар базамда бу ҳақда маълумот йўқ."}]),false);
 assert.equal(isReportedIssueContinuation("Google Play версиясида Pro нархи қанча?",history),false);
 assert.equal(isReportedIssueContinuation("Қандай янги тарифлар бор?",history),false);
});

test("reported issue continuation also recognizes Russian and Tajik wording",()=>{
 assert.equal(isReportedIssueContinuation("Всё ещё не работает",[
  {role:"assistant",content:"Сообщил специалистам об ошибке. Они оперативно рассмотрят проблему."}
 ]),true);
 assert.equal(isReportedIssueContinuation("Ҳанӯз кор намекунад",[
  {role:"assistant",content:"Дар бораи хатогӣ ба мутахассисон хабар додам. Онҳо мушкилотро зуд баррасӣ мекунанд."}
 ]),true);
});
