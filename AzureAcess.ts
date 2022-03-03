import * as pulumi from '@pulumi/pulumi';
import * as azure_native from "@pulumi/azure-native";
import * as k8s from '@pulumi/kubernetes';

export interface AzureAccessArgs {
  namespace: pulumi.Input<string>;
  readOnly: pulumi.Input<boolean>;
}

// Looking how pod identity Can fit all here