import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import * as resources from "@pulumi/azure-native/resources";
import * as azuread from "@pulumi/azuread";
import * as containerservice from "@pulumi/azure-native/containerservice";
import * as k8s from "@pulumi/kubernetes";


//configurations
const config = new pulumi.Config();
export const password = config.require("password");
export const location = config.get("location") || "eastus";
export const generatedKeyPair = new tls.PrivateKey("ssh-key", {
    algorithm: "RSA",
    rsaBits: 4096,
});



// Create the AD service principal for the K8s cluster.
export const addApp = new azuread.Application("addApp", {
    displayName: "my-aks-cluster",
});
export const addSp = new azuread.ServicePrincipal("service-principal", {
    applicationId: addApp.applicationId,
});
export const addSpPassword = new azuread.ServicePrincipalPassword("sp-password", {
    servicePrincipalId: addSp.id,
});

// create k8s managed cluster
export const k8sCluster = new containerservice.ManagedCluster("cluster", {
    resourceGroupName: "ML_Infra",
    agentPoolProfiles: [{
        count: 1,
        mode: "System",
        name: "agentpool",
        nodeLabels: {},
        osDiskSizeGB: 30,
        osType: "Linux",
        type: "VirtualMachineScaleSets",
        vmSize: "Standard_D2_v2",
    }],
    dnsPrefix: "ML_Infra",
    enableRBAC: true,
    linuxProfile: {
        adminUsername: "aksUser",
        ssh: {
            publicKeys: [{
                keyData: generatedKeyPair.publicKeyOpenssh,
            }],
        },
    },
    nodeResourceGroup: "node-resource-group",
    servicePrincipalProfile: {
        clientId: addApp.applicationId,
        secret: addSpPassword.value,
    },
});
const creds = containerservice.listManagedClusterUserCredentialsOutput({
    resourceGroupName: "ML_Infra",
    resourceName: k8sCluster.name,
});
export const kubeconfig =
    creds.kubeconfigs[0].value
        .apply(enc => Buffer.from(enc, "base64").toString());

export const k8sProvider = new k8s.Provider("k8s-provider", {
            kubeconfig: kubeconfig,
        });