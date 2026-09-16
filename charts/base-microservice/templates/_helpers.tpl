{{/*
Namespace efetivo: usa .Values.namespace se definido, senao .Values.name.
Os 5 servicos usam um namespace por servico, igual aos manifestos da Fase 2.
*/}}
{{- define "base-microservice.namespace" -}}
{{- .Values.namespace | default .Values.name -}}
{{- end -}}

{{- define "base-microservice.labels" -}}
app: {{ .Values.name }}
{{- end -}}
