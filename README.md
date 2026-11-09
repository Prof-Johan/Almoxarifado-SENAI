# Almoxarifado Inteligente

Sistema de almoxarifado desenvolvido com os aprendizes da Klabin e o SENAI, com banco de dados central no Supabase.

- **Entrega 1:** login, hierarquia de usuários, classes de cor, unidades, setores e histórico de alterações.
- **Entrega 2:** depósitos e endereços, materiais, saldo com movimentações, etiquetas com QR, fotos, atualização em tempo real e identidade visual do SENAI.
- **Entrega 3:** recebimento com nota fiscal (validação simulada), conferência com checklist do POP, divergência com fotos, aprovação com entrada no estoque, liberação para guarda e modo noturno.
- **Entrega 4 (versão completa):** pedidos pelo setor, aprovação, separação por endereço, retirada com PRN ou foto, devolução, prazo de retirada, inventário periódico, relatórios em Excel, relatório semanal automático, rotatividade, modo offline e atalhos de teclado.
- **Entrega 5 (ajustes dos testadores):** comprovante de retirada em cupom de 80 mm ou A4, contadores de novidades no menu, estoque por setor e centro de custo, fontes Archivo e Source Code Pro, tons pastéis do SENAI e barras de vidro recolhíveis.
- **Entrega 6 (ajustes dos testadores):** PRN do usuário com 8 dígitos no lugar da matrícula, retirada confirmada só pelo PRN, o antigo PRN do material passa a se chamar código SAP, e-mail e PRN de usuário removido podem ser reaproveitados, lista de pedidos com a unidade de medida no lugar do peso e título da página só na barra do topo.
- **Entrega 7 (correção urgente):** materiais contados em unidade, peça, caixa, rolo e afins só aceitam números inteiros em pedido, separação, retirada, devolução, recebimento, inventário, ajuste e cadastro. Só metro, quilo, grama, litro e mililitro aceitam vírgula.

O protótipo anterior, que guardava tudo no navegador, está na pasta `prototipo/` para consulta.

## O que já funciona

- Tela de login por e-mail ou PRN (o código de 8 dígitos da pessoa na empresa), sem cadastro público.
- Recuperação de senha por e-mail e troca obrigatória da senha provisória no primeiro acesso.
- Conta master, que nomeia gestores. Gestores criam usuários com perfis abaixo do seu.
- Bloquear, desbloquear, remover e restaurar usuários. Nada é apagado de verdade.
- Sessão única: entrar em outro aparelho encerra a sessão anterior em até 30 segundos.
- Classes de cor editáveis, com número fixo, aviso de cor repetida e aviso de reimpressão de etiquetas.
- Unidades e setores.
- Histórico de quem criou, editou, removeu ou restaurou cada cadastro. Ninguém consegue alterar esse histórico.
- Depósitos com prateleiras, lados, andares e posições, classes aceitas em cada um e mapa de ocupação.
- Materiais com código SAP, classe, unidade de controle, equivalência da embalagem, estoque mínimo, criticidade, saldo emergencial, peso, EPI, foto e ficha de segurança.
- Código de localização no formato D01-P03-LA-A3-Po2, com uma posição por material e sugestão de posição livre seguindo o POP: pesados embaixo, críticos em altura de fácil acesso.
- Saldo protegido: só muda por movimentação. O ajuste (gestor e master) exige motivo e fica registrado.
- Busca sem acento e sem símbolos ("8x50" encontra "8 x 50"), filtros por classe, depósito e situação do estoque.
- Etiquetas com QR em três formatos (100 × 50 mm, 100 × 150 mm com quadro de quantidade e folha A4). O QR abre o material no sistema. O sistema avisa quais etiquetas precisam ser reimpressas quando nome, classe, cor ou endereço mudam.
- Tudo em tempo real: quando alguém cadastra ou altera algo, as outras telas abertas se atualizam sozinhas, inclusive as listas dentro dos formulários.
- Recebimento no fluxo do POP: recebimento, conferência e etiquetagem, revisão, entrada no estoque e guarda. A nota fiscal é anexada como arquivo (PDF, foto ou XML) e a validação é simulada. A mesma nota do mesmo fornecedor não entra duas vezes.
- Conferência com quantidade conferida por item, diferença calculada na hora e checklist de 7 itens. Sem nota anexada, sem conferência completa ou sem checklist, o sistema não aprova.
- Divergência com descrição e fotos. Com divergência, só gestor ou master aprovam, e entra no estoque a quantidade conferida.
- Pedidos no fluxo SAI+: o solicitante pede pelo computador ou celular, informando setor e motivo de cada item (uso comum, reposição de perdido ou de item sem condições). O sistema mostra o disponível (saldo menos o que já está reservado em pedidos), o peso total e o EPI necessário.
- Saldo emergencial: um pedido que avança sobre ele vai para a aprovação do gestor. O gestor também pode ligar a regra "todo pedido precisa de aprovação" e mudar o prazo de retirada (7 dias por padrão).
- Separação com a lista na ordem do endereço e retirada só com o PRN ou foto de quem leva. Pedido não retirado no prazo vence e libera o saldo reservado.
- Devolução pelo pedido ou avulsa, sempre registrada como movimentação.
- Inventário por depósito, com contagem às cegas, divergências, exportação e ajuste autorizado pelo gestor.
- Relatórios em Excel: estoque atual, movimentações, pedidos, recebimentos e divergências, rotatividade e relatório semanal.
- Rotatividade em três níveis (alta, média e baixa) pelas retiradas dos últimos 90 dias, na ficha do material e nos relatórios.
- Modo offline: o sistema pode ser instalado no celular ou no computador e, sem internet, as consultas usam os últimos dados salvos no aparelho. Para gravar, precisa de conexão. Ao sair, os dados salvos são apagados.
- Atalhos de teclado: `/` busca, `Alt+N` novo cadastro, `Ctrl+S` salvar, `Esc` fechar e `?` lista todos.
- Modo noturno, no botão do topo ou do login. A escolha fica salva no aparelho; sem escolha, segue o modo do celular ou do computador.

## Perfis

| Perfil | Nível | O que faz |
|---|---|---|
| Master | 5 | Tudo. Nomeia gestores e outros masters. |
| Gestor | 4 | Cria usuários de nível 3 para baixo, cuida das classes, unidades e setores e consulta o histórico. |
| Almoxarife | 3 | Recebimento, separação, saídas, materiais e inventário (próximas entregas). |
| Solicitante | 2 | Faz e acompanha os próprios pedidos (próximas entregas). |
| Consulta | 1 | Só consulta. Indicado para aprendizes. |

As regras ficam no banco de dados, na função `validar_gestao_usuario`. Mesmo que alguém altere o código do site, o banco recusa a operação. O sistema também não deixa ficar sem nenhuma conta master ativa.

---

## Instalação

São cinco etapas, nesta ordem: Supabase, conta master, função de servidor, GitHub e Vercel.

> **Já tem a entrega 6 no ar?** Rode o `supabase/migrations/0007_quantidade_inteira.sql` no SQL Editor e envie os arquivos novos para o GitHub. A função de servidor não mudou. No fim, o script lista os materiais com saldo quebrado (por exemplo, 9,6 rolamentos) e os pedidos em aberto com quantidade quebrada: corrija o saldo com **Ajustar saldo** e cancele esses pedidos para serem feitos de novo.
>
> **Ainda na entrega 5?** Rode antes o `0006_prn_usuarios.sql` e publique de novo a função `gerenciar-usuario`, como explicado na entrega 6. Se estiver numa entrega anterior, rode os scripts que faltam, em ordem.

### 1. Supabase: criar o projeto e o banco

1. Em supabase.com, crie um projeto novo só para este sistema. Para a região, escolha São Paulo.
2. Abra **SQL Editor**, clique em **New query**, cole todo o conteúdo de `supabase/migrations/0001_base.sql` e clique em **Run**. Depois faça o mesmo com `0002_materiais.sql`, `0003_recebimento.sql`, `0004_pedidos_relatorios.sql`, `0005_centro_custo.sql`, `0006_prn_usuarios.sql` e `0007_quantidade_inteira.sql`, nesta ordem. Todos têm que terminar sem erro e podem ser rodados de novo sem duplicar nada. Eles também criam os espaços de arquivos `materiais` (fotos e fichas, público) e `recebimentos` (notas e fotos de divergência, privado) e ligam a atualização em tempo real.
3. Em **Authentication**, nas configurações de login, desligue **Allow new users to sign up**. Assim ninguém cria conta sozinho.
4. Em **Authentication > URL Configuration**:
   - **Site URL**: o endereço de produção da Vercel (você volta aqui depois da etapa 5).
   - **Redirect URLs**: adicione `http://localhost:5173/**`, o endereço de produção com `/**` no final e o padrão das prévias da Vercel, por exemplo `https://*-seu-time.vercel.app/**`.

### 2. Criar a conta master

1. Em **Authentication > Users**, clique em **Add user > Create new user**. Informe o seu e-mail e uma senha, marque **Auto Confirm User** e crie.
2. No **SQL Editor**, rode (com o seu e-mail e o seu nome):

   ```sql
   select public.definir_master('seu.email@exemplo.com', 'Seu Nome Completo');
   ```

A resposta deve ser "Conta master definida para ...". Essa função só roda pelo SQL Editor; o site não consegue chamá-la.

### 3. Publicar a função de servidor

A função `gerenciar-usuario` cria e altera contas. Ela precisa da chave de serviço, que nunca pode ficar no site, por isso roda dentro do Supabase.

Pelo painel, que é o caminho mais simples:

1. Abra **Edge Functions** e escolha criar uma função nova pelo editor.
2. O nome tem que ser exatamente `gerenciar-usuario`.
3. Apague o código de exemplo, cole o conteúdo de `supabase/functions/gerenciar-usuario/index.ts` e publique.

Pelo terminal, se preferir:

```bash
npx supabase login
npx supabase link --project-ref ID-DO-PROJETO
npx supabase functions deploy gerenciar-usuario
```

O Supabase entrega a chave de serviço para a função automaticamente. Se ao criar um usuário aparecer "A função está sem a chave de serviço", vá em **Edge Functions > Secrets** e crie o segredo `SERVICE_ROLE_KEY` com a chave service_role (ou secret) do projeto.

### 4. GitHub

No repositório do protótipo, crie uma branch para esta versão. A `main` continua com o protótipo até a versão nova ser aprovada.

```bash
git checkout -b supabase
```

Copie para a pasta do repositório todos os arquivos deste pacote, menos a pasta `node_modules`. Apague da raiz os arquivos antigos `app.js`, `qrcode.js`, `style.css` e `LEIA-ME.txt`, que agora estão em `prototipo/`. Depois:

```bash
git add .
git commit -m "Versão com Supabase: login, usuários, classes e histórico"
git push -u origin supabase
```

Nunca envie para o GitHub o arquivo `.env.local` nem a chave service_role. O `.gitignore` já bloqueia o `.env.local`.

### 5. Vercel

1. Em vercel.com, importe o repositório. O tipo de projeto (Vite) é detectado sozinho. O comando de build é `npm run build` e a pasta de saída é `dist`.
2. Em **Environment Variables**, cadastre as duas variáveis abaixo, marcando Production e Preview. Os valores ficam no Supabase, em **Project Settings > API Keys** (ou no botão **Connect** do projeto).

   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | O endereço do projeto, como `https://abcd1234.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | A chave anon ou publishable. Nunca a service_role. |

3. Faça o deploy. Cada push na branch `supabase` gera um link de prévia; a `main` é a produção.
4. Volte na etapa 1, item 4, e preencha a **Site URL** com o endereço de produção.

Se as variáveis faltarem, o site mostra a tela "Falta configurar o Supabase" em vez do login.

---

## Rodar no computador

Precisa do Node.js 20 ou mais novo.

```bash
npm install
cp .env.example .env.local   # no Windows: copy .env.example .env.local
npm run dev
```

Preencha o `.env.local` com a URL e a chave anon e abra `http://localhost:5173`.

## Roteiro de teste

1. Entre com a conta master.
2. Em **Usuários**, crie o Jean como Gestor, com senha provisória. Anote a senha mostrada.
3. Saia e entre como Jean. O sistema pede uma senha nova antes de liberar.
4. Como Jean, confira que a lista de perfis não oferece Master nem Gestor. Crie um almoxarife e um aprendiz só com PRN, sem e-mail.
5. Entre como o aprendiz pelo PRN. Ele vê o painel, os materiais e as classes, sem botões de alteração.
6. Abra a mesma conta em dois navegadores. O primeiro sai sozinho na hora.
7. Mude a cor de uma classe e veja a alteração em **Histórico**, com o nome de quem mudou.
8. Em **Depósitos**, cadastre os depósitos reais (1, 4, 5, 6, 7 e 17) com o tamanho de cada um. No D01, marque só a classe Químicos.
9. Abra **Materiais** em dois computadores. Cadastre um material em um deles e veja aparecer no outro, sem recarregar.
10. Tente colocar um material elétrico no D01 e um material pesado no último andar: o sistema bloqueia o primeiro e avisa sobre o segundo.
11. Imprima uma etiqueta em PDF, leia o QR com o celular e confira se abre o material.
12. Em **Recebimento**, registre uma nota com dois itens anexando qualquer PDF. Confira as quantidades, marque o checklist e aprove. O saldo dos materiais sobe e a entrada aparece nas movimentações.
13. Faça outro recebimento com uma quantidade menor que a da nota. Como almoxarife, o sistema não deixa aprovar: registre a divergência com uma foto. Entre como gestor e aprove com o conferido.
14. Troque para o modo noturno e confira as telas.
15. Entre como um solicitante e faça um pedido. Como almoxarife, separe e confirme a retirada digitando o PRN do solicitante. O saldo cai e o pedido aparece como retirado.
16. Peça uma quantidade que use o saldo emergencial e confira que o pedido vai para o gestor.
17. Abra um inventário de um depósito, conte um item com diferença e conclua como gestor. O saldo é ajustado e o ajuste aparece nas movimentações.
18. Em Relatórios, gere o relatório semanal e baixe os arquivos em Excel.
19. Com o sistema aberto, desligue a internet: aparece a faixa vermelha e as consultas continuam com os últimos dados.
20. Cadastre os setores Elétrica e Mecânica com as classes que cada um pede. Crie um copo para cada centro de custo, com o mesmo código SAP. Entre como solicitante da Elétrica e confira que ele vê só o copo da Elétrica e não vê rolamentos.
21. Confirme uma retirada e imprima o comprovante em cupom e em A4.
22. Deixe o sistema aberto em Materiais e peça para alguém criar um pedido: o número aparece no item Pedidos do menu.
23. Tente criar um usuário com PRN de 7 dígitos: o sistema recusa. Remova um usuário e crie outro com o mesmo e-mail e o mesmo PRN: agora funciona. Tente restaurar o removido: o sistema avisa que o e-mail já está em uso.
24. Peça 0,4 de um rolamento (contado em unidade): o sistema recusa. Peça 0,4 kg de graxa: aceita.

## Etiquetas

1. Em **Materiais**, marque os itens na lista e clique em **Imprimir etiquetas**, ou abra um material e use **Imprimir etiqueta**. Sem nada marcado, o botão imprime todas as que estão a reimprimir.
2. Escolha o formato. Abre uma página com a prévia.
3. Na janela de impressão do Chrome ou do Edge, deixe as margens em "Nenhuma", a escala em 100% e marque "Gráficos de plano de fundo", senão a faixa da cor não sai. Para PDF, escolha "Salvar como PDF": o arquivo já vem com o nome do material.
4. Depois de imprimir, as etiquetas ficam marcadas como em dia. Se o nome, a classe, a cor da classe ou o endereço mudarem, o material volta para "a reimprimir".

O QR da etiqueta abre o endereço `.../#/materiais/MAT-000123`. Lido pela câmera do celular, ele abre a ficha do material (depois do login).

## Tarefas automáticas

Para o relatório semanal sair sozinho toda segunda às 7h e os pedidos vencidos serem encerrados a cada hora, ative a extensão **pg_cron** no Supabase (Database > Extensions) e rode o `0004_pedidos_relatorios.sql` de novo. Sem o pg_cron, tudo continua funcionando: os pedidos vencem quando alguém abre a página de pedidos, e o relatório da semana sai pelo botão "Gerar agora".

## Estoque por setor e centro de custo

Cada setor é um centro de custo. Em **Unidades e setores**, informe o código do centro de custo e marque as classes que o setor pode pedir. Exemplo: a Elétrica pede Elétrica e Administrativo; a Mecânica pede Mecânica e Administrativo. Com isso, só a Elétrica vê e pede cabos, e só a Mecânica vê e pede rolamentos.

Quando o estoque de um material é de um setor só, escolha esse setor no campo **Centro de custo** do material. Materiais iguais de centros de custo diferentes, como os copos da Elétrica e os copos da Mecânica, são dois cadastros com o mesmo PRN, cada um com o seu saldo. Sem centro de custo, o material é de uso geral.

O solicitante pede sempre pelo setor do próprio cadastro, então todo solicitante precisa ter setor. O banco confere as duas regras, mesmo que alguém tente pedir por fora da tela.

## Comprovante de retirada

Ao confirmar a retirada, aparece o botão **Imprimir comprovante**, em cupom de 80 mm (impressora térmica) ou folha A4. O comprovante traz o pedido, quem retirou, quem entregou, os itens, o peso, o EPI, o espaço para assinatura e um QR que abre o pedido. Ele pode ser reimpresso depois, pelo próprio pedido retirado.

## Menu

Os números laranja no menu mostram o que outras pessoas criaram ou mudaram desde a última vez que você abriu aquela página. Ao abrir a página, o número some. O total também aparece no título da aba do navegador.

As barras lateral e do topo podem ser recolhidas pelas alças na borda de cada uma, com um movimento curto e um som leve de clique. A escolha fica salva no aparelho.

## PRN

O PRN é o código da pessoa na empresa, com exatamente 8 dígitos. Ele é obrigatório no cadastro de usuário, serve para entrar no sistema (no lugar do e-mail) e é o que confirma a retirada de material: o almoxarife digita o PRN de quem está levando e aperta Enter. Um leitor de crachá USB também funciona, desde que digite o PRN. Quem não tem PRN em mãos confirma a retirada pela foto.

Usuários cadastrados antes desta regra continuam entrando com o código antigo até alguém editar o cadastro. O campo crachá deixou de ser usado.

Nos materiais, o campo que antes se chamava PRN agora se chama **código SAP**. Os valores já cadastrados continuam os mesmos.

## Instalar como aplicativo

No Chrome ou no Edge, use "Instalar aplicativo" no menu do navegador. No Android, "Adicionar à tela inicial". O sistema abre em janela própria e funciona para consulta mesmo sem internet.

## Tempo real

O indicador **Ao vivo**, no topo, mostra que as telas estão recebendo as mudanças na hora. Se aparecer **Reconectando**, a internet caiu ou oscilou; quando volta, a tela recarrega sozinha. O plano gratuito do Supabase aguenta até 200 conexões simultâneas, o que sobra para o almoxarifado.

## E-mails

O envio de e-mails padrão do Supabase só entrega para a equipe do projeto e manda poucos e-mails por hora. Durante o desenvolvimento, use senha provisória. Antes de liberar para os usuários, configure um servidor de e-mail próprio em **Authentication > Emails > SMTP Settings**. Só então o convite por e-mail e o "Esqueci minha senha" funcionam para todo mundo.

Usuários sem e-mail entram pelo PRN. Para eles, o sistema cria um endereço interno que termina em `@sem-email.local`, que não recebe mensagens. Quando esquecerem a senha, o gestor define uma provisória.

## Plano do Supabase

No plano gratuito, o projeto é pausado depois de uma semana com pouco uso e não tem backup automático. Para uso real, 24 horas por dia e com backup, o plano Pro resolve as duas coisas.

---

## Estrutura do código

```
index.html                         Página base
src/main.js                        Decide entre login e sistema, monta o menu e as rotas
src/style.css                      Estilos do protótipo do aluno
src/app.css                        Estilos das telas novas
src/lib/supabase.js                Conexão com o Supabase
src/lib/sessao.js                  Login, sessão única e saída
src/lib/permissoes.js              Perfis e regras de hierarquia na tela
src/lib/funcoes.js                 Chamada da função gerenciar-usuario
src/lib/dados.js                   Gravação com confirmação de permissão
src/lib/ui.js                      Janelas, avisos, erros e utilidades
src/pages/acesso.js                Login, recuperação e definição de senha
src/pages/painel.js                Página inicial
src/pages/usuarios.js              Usuários e acessos
src/pages/classes.js               Classes de cor
src/pages/cadastros.js             Unidades e setores
src/pages/historico.js             Histórico de alterações
src/pages/conta.js                 Minha conta
src/pages/materiais.js             Materiais: lista, cadastro, detalhe, ajuste e etiquetas
src/pages/depositos.js             Depósitos, regras de peso e mapa de ocupação
src/pages/recebimentos.js          Recebimento, conferência, divergência e guarda
src/pages/pedidos.js               Pedidos, aprovação, separação, retirada e devolução
src/pages/inventarios.js           Inventário periódico
src/pages/relatorios.js            Relatórios em Excel, semanal e rotatividade
src/lib/excel.js                   Geração dos arquivos .xlsx
src/lib/offline.js                 Modo offline e faixa sem internet
src/lib/atalhos.js                 Atalhos de teclado
src/lib/comprovante.js             Comprovante de retirada (cupom e A4)
src/lib/notificacoes.js            Contadores de novidades no menu
src/lib/clique.js                  Som de clique das barras
src/lib/tema.js                    Modo noturno
src/lib/materiais.js               Código de localização, situação do estoque e dados da etiqueta
src/lib/etiquetas.js               Desenho das etiquetas e janela de impressão
src/lib/arquivos.js                Envio de fotos e PDFs ao Storage
src/lib/tempoReal.js               Atualização em tempo real das telas
src/senai.css                      Cores, logo e cantos da identidade SENAI
public/                            Logo do SENAI (original e branco)
supabase/migrations/0001_base.sql  Tabelas, permissões, histórico e regras
supabase/migrations/0002_materiais.sql  Depósitos, materiais, saldo, etiquetas, arquivos e tempo real
supabase/migrations/0003_recebimento.sql  Recebimento, conferência, divergência e entrada no estoque
supabase/migrations/0004_pedidos_relatorios.sql  Pedidos, retirada, devolução, inventário, rotatividade e relatório semanal
supabase/migrations/0005_centro_custo.sql  Estoque por setor e centro de custo
supabase/migrations/0006_prn_usuarios.sql  PRN do usuário, retirada pelo PRN e e-mail reaproveitável
supabase/migrations/0007_quantidade_inteira.sql  Quantidade inteira para itens que não se dividem
supabase/functions/gerenciar-usuario/index.ts   Função de servidor dos usuários
prototipo/                         Protótipo anterior, só para consulta
```

## Próximos passos

Esta é a versão com todas as funcionalidades levantadas. A partir daqui, os ajustes vêm dos testes da turma. Quando houver nota fiscal real, dá para trocar a validação simulada pela leitura da chave de acesso.
