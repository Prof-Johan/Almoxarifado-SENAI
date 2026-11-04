# Almoxarifado Inteligente

Sistema de almoxarifado desenvolvido com os aprendizes da Klabin e o SENAI, com banco de dados central no Supabase.

- **Entrega 1:** login, hierarquia de usuários, classes de cor, unidades, setores e histórico de alterações.
- **Entrega 2:** depósitos e endereços, materiais, saldo com movimentações, etiquetas com QR, fotos, atualização em tempo real e identidade visual do SENAI.

O protótipo anterior, que guardava tudo no navegador, está na pasta `prototipo/` para consulta.

## O que já funciona

- Tela de login por e-mail ou matrícula, sem cadastro público.
- Recuperação de senha por e-mail e troca obrigatória da senha provisória no primeiro acesso.
- Conta master, que nomeia gestores. Gestores criam usuários com perfis abaixo do seu.
- Bloquear, desbloquear, remover e restaurar usuários. Nada é apagado de verdade.
- Sessão única: entrar em outro aparelho encerra a sessão anterior em até 30 segundos.
- Classes de cor editáveis, com número fixo, aviso de cor repetida e aviso de reimpressão de etiquetas.
- Unidades e setores.
- Histórico de quem criou, editou, removeu ou restaurou cada cadastro. Ninguém consegue alterar esse histórico.
- Depósitos com prateleiras, lados, andares e posições, classes aceitas em cada um e mapa de ocupação.
- Materiais com PRN, classe, unidade de controle, equivalência da embalagem, estoque mínimo, criticidade, saldo emergencial, peso, EPI, foto e ficha de segurança.
- Código de localização no formato D01-P03-LA-A3-Po2, com uma posição por material e sugestão de posição livre seguindo o POP: pesados embaixo, críticos em altura de fácil acesso.
- Saldo protegido: só muda por movimentação. O ajuste (gestor e master) exige motivo e fica registrado.
- Busca sem acento e sem símbolos ("8x50" encontra "8 x 50"), filtros por classe, depósito e situação do estoque.
- Etiquetas com QR em três formatos (100 × 50 mm, 100 × 150 mm com quadro de quantidade e folha A4). O QR abre o material no sistema. O sistema avisa quais etiquetas precisam ser reimpressas quando nome, classe, cor ou endereço mudam.
- Tudo em tempo real: quando alguém cadastra ou altera algo, as outras telas abertas se atualizam sozinhas, inclusive as listas dentro dos formulários.

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

> **Já tem a entrega 1 no ar?** Só rode o `supabase/migrations/0002_materiais.sql` no SQL Editor e envie os arquivos novos para o GitHub. A função de servidor não mudou.

### 1. Supabase: criar o projeto e o banco

1. Em supabase.com, crie um projeto novo só para este sistema. Para a região, escolha São Paulo.
2. Abra **SQL Editor**, clique em **New query**, cole todo o conteúdo de `supabase/migrations/0001_base.sql` e clique em **Run**. Depois faça o mesmo com `supabase/migrations/0002_materiais.sql`. Os dois têm que terminar sem erro e podem ser rodados de novo sem duplicar nada. O segundo também cria o espaço de arquivos `materiais` (fotos e fichas de segurança) e liga a atualização em tempo real.
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
4. Como Jean, confira que a lista de perfis não oferece Master nem Gestor. Crie um almoxarife e um aprendiz só com matrícula.
5. Entre como o aprendiz pela matrícula. Ele vê o painel, os materiais e as classes, sem botões de alteração.
6. Abra a mesma conta em dois navegadores. O primeiro sai sozinho na hora.
7. Mude a cor de uma classe e veja a alteração em **Histórico**, com o nome de quem mudou.
8. Em **Depósitos**, cadastre os depósitos reais (1, 4, 5, 6, 7 e 17) com o tamanho de cada um. No D01, marque só a classe Químicos.
9. Abra **Materiais** em dois computadores. Cadastre um material em um deles e veja aparecer no outro, sem recarregar.
10. Tente colocar um material elétrico no D01 e um material pesado no último andar: o sistema bloqueia o primeiro e avisa sobre o segundo.
11. Imprima uma etiqueta em PDF, leia o QR com o celular e confira se abre o material.

## Etiquetas

1. Em **Materiais**, marque os itens na lista e clique em **Imprimir etiquetas**, ou abra um material e use **Imprimir etiqueta**. Sem nada marcado, o botão imprime todas as que estão a reimprimir.
2. Escolha o formato. Abre uma página com a prévia.
3. Na janela de impressão do Chrome ou do Edge, deixe as margens em "Nenhuma", a escala em 100% e marque "Gráficos de plano de fundo", senão a faixa da cor não sai. Para PDF, escolha "Salvar como PDF": o arquivo já vem com o nome do material.
4. Depois de imprimir, as etiquetas ficam marcadas como em dia. Se o nome, a classe, a cor da classe ou o endereço mudarem, o material volta para "a reimprimir".

O QR da etiqueta abre o endereço `.../#/materiais/MAT-000123`. Lido pela câmera do celular, ele abre a ficha do material (depois do login).

## Tempo real

O indicador **Ao vivo**, no topo, mostra que as telas estão recebendo as mudanças na hora. Se aparecer **Reconectando**, a internet caiu ou oscilou; quando volta, a tela recarrega sozinha. O plano gratuito do Supabase aguenta até 200 conexões simultâneas, o que sobra para o almoxarifado.

## E-mails

O envio de e-mails padrão do Supabase só entrega para a equipe do projeto e manda poucos e-mails por hora. Durante o desenvolvimento, use senha provisória. Antes de liberar para os usuários, configure um servidor de e-mail próprio em **Authentication > Emails > SMTP Settings**. Só então o convite por e-mail e o "Esqueci minha senha" funcionam para todo mundo.

Usuários sem e-mail entram pela matrícula. Para eles, o sistema cria um endereço interno que termina em `@sem-email.local`, que não recebe mensagens. Quando esquecerem a senha, o gestor define uma provisória.

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
src/lib/materiais.js               Código de localização, situação do estoque e dados da etiqueta
src/lib/etiquetas.js               Desenho das etiquetas e janela de impressão
src/lib/arquivos.js                Envio de fotos e PDFs ao Storage
src/lib/tempoReal.js               Atualização em tempo real das telas
src/senai.css                      Cores, logo e cantos da identidade SENAI
public/                            Logo do SENAI (original e branco)
supabase/migrations/0001_base.sql  Tabelas, permissões, histórico e regras
supabase/migrations/0002_materiais.sql  Depósitos, materiais, saldo, etiquetas, arquivos e tempo real
supabase/functions/gerenciar-usuario/index.ts   Função de servidor dos usuários
prototipo/                         Protótipo anterior, só para consulta
```

## Próximas entregas

1. Recebimento com foto da nota fiscal, checklist e divergências. É por ele que o saldo vai entrar.
2. Pedidos, separação e retirada com crachá ou foto.
3. Relatórios em Excel, relatório semanal, rotatividade e modo offline.
