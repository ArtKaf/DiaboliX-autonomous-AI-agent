import neo4j from 'neo4j-driver';
import crypto from 'node:crypto';
export async function indexAst(workspace, ast) {
 const {NEO4J_URI,NEO4J_USER,NEO4J_PASSWORD,NEO4J_DATABASE='neo4j'}=process.env;
 if(!NEO4J_URI||!NEO4J_USER||!NEO4J_PASSWORD)throw Error('Neo4j не настроен: задайте NEO4J_URI, NEO4J_USER и NEO4J_PASSWORD при запуске сервера');
 const project=crypto.createHash('sha256').update(workspace).digest('hex'); const driver=neo4j.driver(NEO4J_URI,neo4j.auth.basic(NEO4J_USER,NEO4J_PASSWORD));const session=driver.session({database:NEO4J_DATABASE});
 try { await session.executeWrite(async tx=>{
  await tx.run('MERGE (f:DiabolixFile {project:$project, path:$path}) SET f.language=$language', {project,path:ast.path,language:ast.language});
  await tx.run('MATCH (f:DiabolixFile {project:$project, path:$path})-[:CONTAINS]->(n:DiabolixSymbol) DETACH DELETE n',{project,path:ast.path});
  await tx.run('MATCH (f:DiabolixFile {project:$project, path:$path}) UNWIND $nodes AS item CREATE (n:DiabolixSymbol {type:item.type, name:item.name, line:item.line, text:item.text}) CREATE (f)-[:CONTAINS]->(n)',{project,path:ast.path,nodes:ast.nodes});
 });return `Индексирован ${ast.path}: ${ast.nodes.length} AST-элементов в Neo4j`;}finally{await session.close();await driver.close()}
}
