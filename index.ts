import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import * as random from "@pulumi/random";
import * as k8s from "@pulumi/kubernetes";
import * as cluster from "./cluster";
import TraefikRoute from "./TraefikRoute";
import * as azuread from "@pulumi/azuread";


const config = new pulumi.Config();
const tenantId = config.require("tenantId");
//create new resource group
//const MLGroup = new azure.core.ResourceGroup("MLGroup", {location: "South Central US"});

//creating random passowrd for the postgresql server
const serverpassword = new random.RandomPassword("password", {
    length: 16,
    special: true,
    overrideSpecial: `!@#$%&*()-_=+[]{}<>:?`,
});

// Create the AD service principal for the K8s cluster.
const addApp = new azuread.Application("addApp", {
    displayName: "my-aks-cluster",
});
const addSp = new azuread.ServicePrincipal("service-principal", {
    applicationId: addApp.applicationId,
});
const addSpPassword = new azuread.ServicePrincipalPassword("sp-password", {
    servicePrincipalId: addSp.id,
});


// create postgresql server for our model matadata in MLFLOW
const mlflowDBserver = new azure.postgresql.Server("mlflow-db-server", {
    resourceGroupName: "ML_Infra",
    administratorLogin: "mlflow",
    administratorLoginPassword: serverpassword.result,
    skuName: "GP_Gen5_4",
    version: "9.6",
    storageMb: 640000,
    backupRetentionDays: 7,
    geoRedundantBackupEnabled: true,
    autoGrowEnabled: true,
    publicNetworkAccessEnabled: false,
    sslEnforcementEnabled: true,
    sslMinimalTlsVersionEnforced: "TLS1_2",
    identity: {
        type: "SystemAssigned",
        principalId: addApp.id,
        tenantId: tenantId,
    }
});
//creating postgresql database
const mlflowDB = new azure.postgresql.Database("mlflow-db", {
    resourceGroupName: "ML_Infra",
    serverName: mlflowDBserver.name,
    name:"mlflow-db",
    charset: "UTF8",
    collation: "English_United States.1252",
});

//create storage account for ADLS gen 2
const StorageAccount = new azure.storage.Account("storageaccount", {
    resourceGroupName: "ML_Infra",
    accountTier: "Standard",
    accountReplicationType: "LRS",
    accountKind: "StorageV2",
    isHnsEnabled: true,
});
// create ADLS gen2 to be the Artifact store for Mlflow
const Azureartifactstore = new azure.storage.DataLakeGen2Filesystem("artifactstorage", {
    storageAccountId: StorageAccount.id,
    name: "artifactstore",
});


// create ADLS filePath for mflow defaultArtifactRoot
const artifactstoreFile = new azure.storage.DataLakeGen2Path("artifactstoreFile", {
    path: "artifactstore",
    filesystemName: Azureartifactstore.name,
    storageAccountId: StorageAccount.id,
    resource: "directory",
});


// Install MLFlow
const mlflowNamespace = new k8s.core.v1.Namespace('mlflow-namespace', {
    metadata: { name: 'mlflow' },
  }, { provider: cluster.k8sProvider });

//install mlflow
const mlflow = new k8s.helm.v3.Chart("mlflow", {
    chart: "traefik",
    values:{
        "backendStore": {
            "postgres": {
              "username": mlflowDBserver.administratorLogin,
              "password": mlflowDBserver.administratorLoginPassword,
              "host": mlflowDBserver,
              "port": 5342,
              "database": "mlflow-db"
              
            }
          },
          "defaultArtifactRoot": artifactstoreFile.path,
    },
    fetchOpts:{
        repo: "https://larribas.me/helm-charts",
    },
}, { provider: cluster.k8sProvider });

//install traefik
const traefik = new k8s.helm.v3.Chart("my-model-route", {
    chart: "traefik",
    fetchOpts:{
        repo: "https://helm.traefik.io/traefik",
    },
}, { provider: cluster.k8sProvider });





// route /mflow to MLflow
 new TraefikRoute('mlflow-route',{
     prefix: '/models/my-model',
     service: mlflow.getResource('v1/Service', 'mlflow'),
     namespace: "default",
 },{ provider: cluster.k8sProvider });

 // azure dns provider
const dnsZone = new azure.dns.Zone("dnsZone", {
    resourceGroupName: "ML_Infra",
    name: "redbridge.co.ke",
});
const exampleARecord = new azure.dns.ARecord("record", {
    zoneName: dnsZone.name,
    resourceGroupName: "ML_Infra",
    ttl: 300,
    records: [traefik.getResource('v1/Service', 'traefik').status.loadBalancer.ingress[0].hostname],
});