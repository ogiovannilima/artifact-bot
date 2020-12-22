import { Application, Context } from 'probot' // eslint-disable-line no-unused-vars
import fs from 'fs';
import Axios from 'axios'
import Path from 'path'
import { exec } from 'child_process'
import YAML from 'yaml'
import qs from 'querystring'
const rimraf = require("rimraf");
const AdmZip = require('adm-zip')

export = (app: Application) => {
  app.on('release.released', async (context) => {
    manageAsset(context)    
  })
}

async function manageAsset(context: Context){

  const repo = context.payload.repository.name
  const owner = context.payload.repository.owner.login

  const dir = './chart'
  if (!fs.existsSync(dir)){
    fs.mkdirSync(dir)
  }
 
  const urlAsset = context.payload.release.zipball_url.toString()

  const path = Path.resolve(__dirname,'../chart',`asset-${repo}-release${context.payload.release.tag_name}-${owner}.zip`)
  const outputPath = Path.resolve(__dirname,'../chart/unzip')
  const writer = fs.createWriteStream(path)

  const response = await Axios({
    url: urlAsset,
    method: 'GET',
    responseType: 'stream',
    headers: {
      'Authorization': 'token '
    }
  })

  const writeFile = () => {

    return new Promise((resolve, reject) => {
      response.data.pipe(writer)
      let error: any = null
      writer.on('error', err => {
        error = err
        writer.close()
        reject(err)
      })

      writer.on('close', () => {
        if(!error) {
          resolve(true)
        }
      })
    })
  }

  await writeFile()
  const zip = new AdmZip(path)
  zip.extractAllTo(outputPath, false)

  const zipEntries = zip.getEntries()

  const folderName = zipEntries[0].entryName
   
  await fs.unlink(path,(err) => {
    if(err) throw err
  })

  helmCompile(context, folderName)

}

async function helmCompile(context: Context, folderName: String){

  const repo = context.payload.repository.name
  const owner = context.payload.repository.owner.login
  const projectName = context.payload.repository.name
  const spinnakerRepo = process.env["SPINNAKER_REPO"]??`spinnaker`
  const refSpinnaker = process.env["REF_SPINNAKER"]?? `heads/main`
  const envs  = ['stg','sit','hlg','prd']

  const deletePath = Path.resolve(__dirname,'../chart')

  const path = Path.resolve(__dirname,`../chart/unzip/${folderName}.viaops.yml`)
  const existViaOps = fs.existsSync(path)

  if (!existViaOps){
    return console.log('.viaops.yml file does not exist in root project')
  }
  
  const deployFile = fs.readFileSync(path,'utf8')
  const deployContent = YAML.parse(deployFile)
  const products = deployContent['component-of'] || null
  const version = deployContent['version'] || null
  const namespacePrefix = deployContent.deploy?.['namespace-prefix']
  if (namespacePrefix == null || namespacePrefix == undefined){
    return console.log('namespace-prefix is null or undefined')
  }

  await execHelmDependencyUpdate(folderName.toString());

  const flag = deployContent.deploy?.['flag']

  sendImageArtifact(`${spinnakerRepo}/blob/master/${projectName}/deploy-sit.yaml`, products.map((product: { name: any; }) => { return { 'productName': product.name! }}), projectName, version)
  const blobsPromises = envs.map(async env => { 

    const outputHelm = await execHelm(env, repo, namespacePrefix, flag, folderName.toString())
    const outputBase64 = Buffer.from(outputHelm).toString('base64')
    const blob = await createBlob(context,owner,spinnakerRepo,outputBase64) 
    
    return {
      path: `${projectName}/deploy-${env}.yaml`,
      mode: '100644',
      type: 'blob',
      sha: blob.data.sha,
    }  
  })

  const blobs = await Promise.all(blobsPromises)

  let commitStatus: any
  let retry: number = 0

  do {
    commitStatus = await commitProcess(owner, spinnakerRepo, blobs, refSpinnaker, context)
    retry++
    console.log(commitStatus.headers.status)
  } while(commitStatus.status != 200 && retry < 3) 
  
  rimraf(deletePath, () => {
    console.log("files deleted") 
  });
  
}

async function createBlob (
  context: Context, 
  owner: string, 
  spinnakerRepo: string, 
  outputBase64: string
): Promise <any> {

    const blob = await context.octokit.git.createBlob({
    owner,
    repo: spinnakerRepo,
    content: outputBase64,
    encoding: 'base64'
  })

  return blob  
}  

async function execHelm(env: string, repo: string, namespacePrefix: string, flag: string[], folderName: string): Promise<any>{

  let values: string = ''
  let commands: string = ''
  let yamlContent: string = ''

  if (flag){

    const valuesFile = Path.resolve(__dirname,`../chart/unzip/${folderName}chart/${flag}/values-${env}.yaml`)
    const existFile = fs.existsSync(valuesFile)

    if (existFile){
      values = `--values ./chart/unzip/${folderName}chart/${flag}/values-${env}.yaml`
    }else{
      throw new Error(`Does not exist values to ${flag}`)      
    }
    
    const flagMap = flag.map(flagItem => {
      commands = `helm template ${repo}-${flagItem} ./chart/unzip/${folderName}chart --no-hooks --namespace ${namespacePrefix}-${env} ${values} `

      return new Promise((resolve, reject) => {

        exec(commands, async (error, stdout, stderr) => {
          if (error) {
            reject(error)
            return;
          }
          if (stderr) {
            reject(error)
            return;
          }
          yamlContent += stdout
          resolve(stdout)    
          return yamlContent
        })
      })

    })

    const yaml = await Promise.all(flagMap)
    return yaml.join('\n')

  }else{

    const valuesFile = Path.resolve(__dirname,`../chart/unzip/${folderName}chart/values-${env}.yaml`)
    const existFile = fs.existsSync(valuesFile)

    if (existFile){
      values = `--values ./chart/unzip/${folderName}chart/values-${env}.yaml`
    }
    commands = `helm template ${repo} ./chart/unzip/${folderName}chart --no-hooks --namespace ${namespacePrefix}-${env} ${values}`
    
    return new Promise((resolve, reject) => {

      exec(commands, async (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return;
        }
        if (stderr) {
          reject(error)
          return;
        }
        resolve(stdout)    
      })
    })

  }

}

async function execHelmDependencyUpdate(folderName: string) {
  return new Promise((resolve, reject) => {

    exec(`helm dependency update ./chart/unzip/${folderName}chart`, async (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return;
      }
      if (stderr) {
        reject(error)
        return;
      }
      resolve(stdout)

    })
  })
}

async function createTree(owner: string, repo: string, commitTree: string, blobs: any[], context: Context): Promise<any>{
  const tree = await context.octokit.git.createTree({
    owner,
    repo,
    tree: blobs,
    base_tree: commitTree
  });

  return tree
}

async function createCommit(
  owner: string, 
  repo: string, 
  tree: string, 
  parents: string[], 
  context: Context
  ): Promise<any>{
  const commit = await context.octokit.git.createCommit({
    owner,
    repo,
    message: `${context.payload.release.tag_name}`,
    tree,
    parents,
  });

  return commit

}

async function getSHATree(owner: string, spinnakerRepo: string, spinakerSha: string , context: Context): Promise<any>{
    const commitSpinnaker = await context.octokit.git.getCommit({
    owner,
    repo: spinnakerRepo,
    commit_sha: spinakerSha,
  });
 
  return commitSpinnaker
}

async function updateRef(
  owner: string, 
  repo: string, 
  ref: string, 
  sha: string, 
  context: Context
  ): Promise<any>{

  try {
    return await context.octokit.git.updateRef({
      owner,
      repo,
      ref,
      sha
    });

  } catch (error) {
    return error  
  }
}

async function getRef(owner: string, spinnakerRepo: string, refSpinnaker: string, context: Context): Promise<any>{
  const spinnaker = await context.octokit.git.getRef({
    owner,
    repo: spinnakerRepo,
    ref: refSpinnaker,
  });

  return spinnaker
}

async function commitProcess(owner: string, spinnakerRepo: string, blobs: any[], refSpinnaker: string, context: Context): Promise<any>{

  const spinnaker = await getRef(owner, spinnakerRepo,refSpinnaker, context)
  const refs = spinnaker.data.ref.split('/')
  
  const shaTree = await getSHATree(owner,spinnakerRepo, spinnaker.data.object.sha, context)
  const commitSHA = shaTree.data.sha
  const commitTreeSHA = shaTree.data.tree.sha
  
  const tree = await createTree(owner, spinnakerRepo, commitTreeSHA, blobs, context)
  const treeSHA = tree.data.sha

  const commit = await createCommit(owner, spinnakerRepo, treeSHA ,[commitSHA], context)
  const newCommit = commit.data.sha

  const update = await updateRef(owner, spinnakerRepo, `${refs[1]}/${refs[2]}`, newCommit, context)

  return update
}
          
async function viaopsToken(){
    return await Axios.post(process.env.LOGIN_URL!, qs.stringify({
      client_id: process.env.CLIENT_ID,
      grant_type: process.env.GRANT_TYPE, 
      username: process.env.VIAOPS_USERNAME,
      password: process.env.VIAOPS_PASSWORD,
      scope: process.env.SCOPE
    }), {
      headers:{
        'content-type': 'application/x-www-form-urlencoded;charset=utf-8'
      }
    }).catch(e => 
      console.log(`Error getting Viaops token: ${e}`)
    ).then(( response ) => { 
      return response != null ? response.data.access_token : ``;
    })
}

async function sendImageArtifact(imageUrl: string,  products: any[], name: string, version: string){
  const tokenViaops = await viaopsToken()
  await Axios.post(`${process.env.VIAOPS_URL}/api/products/artifacts`, {
    name: name,
    url: `${imageUrl}`,
    version: version,
    products: products,
    type: "Helm"
  }, {
    headers:{
      Authorization: `Bearer ${tokenViaops}`
    }
  }).catch(e =>
    console.log(`Error api: ${e}`)   
  )
  
}
