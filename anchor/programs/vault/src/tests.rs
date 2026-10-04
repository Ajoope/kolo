#[cfg(test)]
mod tests {
    use crate::ID as PROGRAM_ID;
    use crate::{instruction, Circle, CircleStatus, Member};
    use anchor_lang::{system_program, AccountDeserialize, InstructionData, ToAccountMetas};
    use anchor_spl::token;
    use litesvm::LiteSVM;
    use solana_sdk::{
        account::Account,
        clock::Clock,
        instruction::Instruction,
        pubkey::Pubkey,
        signature::Keypair,
        signer::Signer,
        sysvar::SysvarId,
        transaction::Transaction,
    };

    const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
    const USDC_DECIMALS: u8 = 6;
    const ONE_USDC: u64 = 1_000_000; // 1 USDC in base units

    fn create_mint_data(mint_authority: &Pubkey, decimals: u8) -> Vec<u8> {
        let mut data = vec![0u8; 82];
        data[0..4].copy_from_slice(&1u32.to_le_bytes()); // COption::Some
        data[4..36].copy_from_slice(mint_authority.as_ref());
        data[36..44].copy_from_slice(&0u64.to_le_bytes()); // supply
        data[44] = decimals;
        data[45] = 1; // is_initialized = true
        data
    }

    fn create_token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; 165];
        data[0..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(owner.as_ref());
        data[64..72].copy_from_slice(&amount.to_le_bytes());
        data[108] = 1; // state = Initialized
        data
    }

    fn get_circle_pda(creator: &Pubkey, circle_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"circle", creator.as_ref(), &circle_id.to_le_bytes()],
            &PROGRAM_ID,
        )
    }

    fn get_vault_pda(circle: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"vault", circle.as_ref()], &PROGRAM_ID)
    }

    fn get_member_pda(circle: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"member", circle.as_ref(), wallet.as_ref()], &PROGRAM_ID)
    }

    struct TestEnvironment {
        svm: LiteSVM,
        creator: Keypair,
        usdc_mint: Pubkey,
        members: Vec<Keypair>,
        member_atas: Vec<Pubkey>,
    }

    fn setup_env(num_members: usize, initial_usdc_per_member: u64) -> TestEnvironment {
        let mut svm = LiteSVM::new();

        // Load and register the compiled program binary into LiteSVM
        let program_bytes = include_bytes!("../../../target/deploy/vault.so");
        svm.add_program(PROGRAM_ID, program_bytes).expect("Failed to add vault program");

        let creator = Keypair::new();
        svm.airdrop(&creator.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let usdc_mint = Pubkey::new_unique();
        let mint_account = Account {
            lamports: 10_000_000,
            data: create_mint_data(&creator.pubkey(), USDC_DECIMALS),
            owner: token::ID,
            executable: false,
            rent_epoch: 0,
        };
        svm.set_account(usdc_mint, mint_account).unwrap();

        let mut members = Vec::new();
        let mut member_atas = Vec::new();

        for _ in 0..num_members {
            let m = Keypair::new();
            svm.airdrop(&m.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

            let ata = Pubkey::new_unique();
            let ata_account = Account {
                lamports: 10_000_000,
                data: create_token_account_data(&usdc_mint, &m.pubkey(), initial_usdc_per_member),
                owner: token::ID,
                executable: false,
                rent_epoch: 0,
            };
            svm.set_account(ata, ata_account).unwrap();

            members.push(m);
            member_atas.push(ata);
        }

        TestEnvironment {
            svm,
            creator,
            usdc_mint,
            members,
            member_atas,
        }
    }

    fn get_token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
        let acc = svm.get_account(token_account).expect("Token account not found");
        let mut amount_bytes = [0u8; 8];
        amount_bytes.copy_from_slice(&acc.data[64..72]);
        u64::from_le_bytes(amount_bytes)
    }

    #[test]
    fn test_normal_full_cycle_completion() {
        let contribution_amount = 50 * ONE_USDC; // 50 USDC per round
        let frequency = 604_800; // 1 week
        let max_members = 3u8;
        let circle_id = 1u64;

        let mut env = setup_env(3, 500 * ONE_USDC);
        let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
        let (vault_pda, _) = get_vault_pda(&circle_pda);

        // 1. Create Circle
        let create_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::CreateCircle {
                creator: env.creator.pubkey(),
                circle: circle_pda,
                vault: vault_pda,
                usdc_mint: env.usdc_mint,
                system_program: system_program::ID,
                token_program: token::ID,
                rent: anchor_lang::prelude::Rent::id(),
            }
            .to_account_metas(None),
            data: instruction::CreateCircle {
                circle_id,
                contribution_amount,
                frequency,
                max_members,
                payout_order: vec![],
            }
            .data(),
        };

        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&env.creator.pubkey()),
            &[&env.creator],
            blockhash,
        );
        env.svm.send_transaction(tx).expect("Create circle should succeed");

        // 2. Members Join and Stake
        for i in 0..3 {
            let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
            let join_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::JoinCircle {
                    member_wallet: env.members[i].pubkey(),
                    circle: circle_pda,
                    member: member_pda,
                    vault: vault_pda,
                    member_token_account: env.member_atas[i],
                    system_program: system_program::ID,
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::JoinCircle.data(),
            };

            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(
                &[join_ix],
                Some(&env.members[i].pubkey()),
                &[&env.members[i]],
                blockhash,
            );
            env.svm.send_transaction(tx).expect("Join circle should succeed");
        }

        // Verify circle is now Active and 3 stakes are locked (150 USDC in vault)
        assert_eq!(get_token_balance(&env.svm, &vault_pda), 150 * ONE_USDC);
        let circle_acc = env.svm.get_account(&circle_pda).unwrap();
        let circle_state: Circle = Circle::try_deserialize(&mut circle_acc.data.as_slice()).unwrap();
        assert_eq!(circle_state.status, CircleStatus::Active);
        assert_eq!(circle_state.member_count, 3);

        // 3. Execute Rounds 0, 1, 2
        for round in 0..3 {
            // All members contribute for current round
            for i in 0..3 {
                let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
                let contribute_ix = Instruction {
                    program_id: PROGRAM_ID,
                    accounts: crate::accounts::Contribute {
                        member_wallet: env.members[i].pubkey(),
                        circle: circle_pda,
                        member: member_pda,
                        vault: vault_pda,
                        member_token_account: env.member_atas[i],
                        token_program: token::ID,
                    }
                    .to_account_metas(None),
                    data: instruction::Contribute.data(),
                };

                env.svm.expire_blockhash();
                let blockhash = env.svm.latest_blockhash();
                let tx = Transaction::new_signed_with_payer(
                    &[contribute_ix],
                    Some(&env.members[i].pubkey()),
                    &[&env.members[i]],
                    blockhash,
                );
                env.svm.send_transaction(tx).expect("Contribute should succeed");
            }

            // Release payout to recipient for this round (member[round])
            let recipient_idx = round;
            let (recipient_member_pda, _) = get_member_pda(&circle_pda, &env.members[recipient_idx].pubkey());
            let recipient_bal_before = get_token_balance(&env.svm, &env.member_atas[recipient_idx]);

            // Advance the clock past the round deadline so release_payout is permitted.
            let mut clock = env.svm.get_sysvar::<Clock>();
            clock.unix_timestamp += frequency;
            env.svm.set_sysvar::<Clock>(&clock);

            let release_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::ReleasePayout {
                    caller: env.members[recipient_idx].pubkey(),
                    circle: circle_pda,
                    recipient_member: recipient_member_pda,
                    vault: vault_pda,
                    recipient_token_account: env.member_atas[recipient_idx],
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::ReleasePayout.data(),
            };

            env.svm.expire_blockhash();
            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(
                &[release_ix],
                Some(&env.members[recipient_idx].pubkey()),
                &[&env.members[recipient_idx]],
                blockhash,
            );
            env.svm.send_transaction(tx).expect("Release payout should succeed");

            let recipient_bal_after = get_token_balance(&env.svm, &env.member_atas[recipient_idx]);
            // Pot was 3 * 50 = 150 USDC
            assert_eq!(recipient_bal_after - recipient_bal_before, 150 * ONE_USDC);
        }

        // Circle is now Completed
        let circle_acc = env.svm.get_account(&circle_pda).unwrap();
        let circle_state: Circle = Circle::try_deserialize(&mut circle_acc.data.as_slice()).unwrap();
        assert_eq!(circle_state.status, CircleStatus::Completed);

        // 4. All members reclaim their collateral stakes
        for i in 0..3 {
            let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
            let bal_before = get_token_balance(&env.svm, &env.member_atas[i]);

            let complete_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::CompleteCircle {
                    member_wallet: env.members[i].pubkey(),
                    circle: circle_pda,
                    member: member_pda,
                    vault: vault_pda,
                    member_token_account: env.member_atas[i],
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::CompleteCircle.data(),
            };

            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(
                &[complete_ix],
                Some(&env.members[i].pubkey()),
                &[&env.members[i]],
                blockhash,
            );
            env.svm.send_transaction(tx).expect("Stake refund should succeed");

            let bal_after = get_token_balance(&env.svm, &env.member_atas[i]);
            assert_eq!(bal_after - bal_before, 50 * ONE_USDC);
        }

        // Vault is now cleanly emptied
        assert_eq!(get_token_balance(&env.svm, &vault_pda), 0);
    }

    #[test]
    fn test_mid_cycle_default_with_skip_ahead_payout() {
        let contribution_amount = 50 * ONE_USDC;
        let frequency = 604_800; // 1 week
        let max_members = 3u8;
        let circle_id = 2u64;

        let mut env = setup_env(3, 500 * ONE_USDC);
        let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
        let (vault_pda, _) = get_vault_pda(&circle_pda);

        // Create Circle
        let create_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::CreateCircle {
                creator: env.creator.pubkey(),
                circle: circle_pda,
                vault: vault_pda,
                usdc_mint: env.usdc_mint,
                system_program: system_program::ID,
                token_program: token::ID,
                rent: anchor_lang::prelude::Rent::id(),
            }
            .to_account_metas(None),
            data: instruction::CreateCircle {
                circle_id,
                contribution_amount,
                frequency,
                max_members,
                payout_order: vec![],
            }
            .data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
        env.svm.send_transaction(tx).unwrap();

        // 3 Members Join
        for i in 0..3 {
            let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
            let join_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::JoinCircle {
                    member_wallet: env.members[i].pubkey(),
                    circle: circle_pda,
                    member: member_pda,
                    vault: vault_pda,
                    member_token_account: env.member_atas[i],
                    system_program: system_program::ID,
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::JoinCircle.data(),
            };
            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
            env.svm.send_transaction(tx).unwrap();
        }

        // Round 0: Member 0 and 2 contribute on time, Member 1 misses deadline and grace period
        for i in &[0, 2] {
            let (member_pda, _) = get_member_pda(&circle_pda, &env.members[*i].pubkey());
            let contribute_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::Contribute {
                    member_wallet: env.members[*i].pubkey(),
                    circle: circle_pda,
                    member: member_pda,
                    vault: vault_pda,
                    member_token_account: env.member_atas[*i],
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::Contribute.data(),
            };
            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[*i].pubkey()), &[&env.members[*i]], blockhash);
            env.svm.send_transaction(tx).unwrap();
        }

        // Advance clock past round frequency + grace period (1 week + 60h + buffer)
        let mut clock = env.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += frequency + 216_000 + 1000;
        env.svm.set_sysvar::<Clock>(&clock);

// Process default for Member 1 (any circle member may trigger this)
        let (member1_pda, _) = get_member_pda(&circle_pda, &env.members[1].pubkey());
        let default_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::ProcessDefault {
                caller: env.members[1].pubkey(),
                caller_member: member1_pda,
                circle: circle_pda,
                member: member1_pda,
            }
            .to_account_metas(None),
            data: instruction::ProcessDefault.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[default_ix], Some(&env.members[1].pubkey()), &[&env.members[1]], blockhash);
        env.svm.send_transaction(tx).expect("Process default should succeed");

        // Verify Member 1 is marked defaulted
        let member1_acc = env.svm.get_account(&member1_pda).unwrap();
        let member1_state: Member = Member::try_deserialize(&mut member1_acc.data.as_slice()).unwrap();
        assert!(member1_state.has_defaulted);
        assert_eq!(member1_state.stake_amount, 0);

        // Release payout for Round 0 to Member 0 (pot = 2 * 50 contributions + 1 * 50 forfeited stake = 150 USDC)
        let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
        let bal0_before = get_token_balance(&env.svm, &env.member_atas[0]);

        let release_ix0 = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::ReleasePayout {
                caller: env.creator.pubkey(),
                circle: circle_pda,
                recipient_member: member0_pda,
                vault: vault_pda,
                recipient_token_account: env.member_atas[0],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::ReleasePayout.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[release_ix0], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
        env.svm.send_transaction(tx).unwrap();

        assert_eq!(get_token_balance(&env.svm, &env.member_atas[0]) - bal0_before, 150 * ONE_USDC);

        // Round 1: Member 0 and Member 2 contribute
        for i in &[0, 2] {
            let (member_pda, _) = get_member_pda(&circle_pda, &env.members[*i].pubkey());
            let contribute_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::Contribute {
                    member_wallet: env.members[*i].pubkey(),
                    circle: circle_pda,
                    member: member_pda,
                    vault: vault_pda,
                    member_token_account: env.member_atas[*i],
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::Contribute.data(),
            };
            env.svm.expire_blockhash();
            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[*i].pubkey()), &[&env.members[*i]], blockhash);
            env.svm.send_transaction(tx).unwrap();
        }

        // Release payout for Round 1: Member 1 in payout_order is defaulted, so payout skips directly to Member 2!
        // Round 1's deadline is current_round_start (reset by the Round 0 release) + frequency, so advance the clock.
        let mut clock = env.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += frequency;
        env.svm.set_sysvar::<Clock>(&clock);

        let (member2_pda, _) = get_member_pda(&circle_pda, &env.members[2].pubkey());
        let bal2_before = get_token_balance(&env.svm, &env.member_atas[2]);

        let release_ix1 = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::ReleasePayout {
                caller: env.creator.pubkey(),
                circle: circle_pda,
                recipient_member: member2_pda,
                vault: vault_pda,
                recipient_token_account: env.member_atas[2],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::ReleasePayout.data(),
        };
        env.svm.expire_blockhash();
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[release_ix1], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
        env.svm.send_transaction(tx).expect("Payout should skip defaulted Member 1 to Member 2");

        let bal2_after = get_token_balance(&env.svm, &env.member_atas[2]);
        assert_eq!(bal2_after - bal2_before, 100 * ONE_USDC); // 2 active members contributed 50 USDC each
    }

    #[test]
    fn test_late_fee_grace_period_path() {
        let contribution_amount = 100 * ONE_USDC;
        let frequency = 604_800; // 1 week
        let max_members = 2u8;
        let circle_id = 3u64;

        let mut env = setup_env(2, 500 * ONE_USDC);
        let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
        let (vault_pda, _) = get_vault_pda(&circle_pda);

        // 1. Create Circle
        let create_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::CreateCircle {
                creator: env.creator.pubkey(),
                circle: circle_pda,
                vault: vault_pda,
                usdc_mint: env.usdc_mint,
                system_program: system_program::ID,
                token_program: token::ID,
                rent: anchor_lang::prelude::Rent::id(),
            }
            .to_account_metas(None),
            data: instruction::CreateCircle {
                circle_id,
                contribution_amount,
                frequency,
                max_members,
                payout_order: vec![],
            }
            .data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
        env.svm.send_transaction(tx).unwrap();

        // 2. Members Join
        for i in 0..2 {
            let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
            let join_ix = Instruction {
                program_id: PROGRAM_ID,
                accounts: crate::accounts::JoinCircle {
                    member_wallet: env.members[i].pubkey(),
                    circle: circle_pda,
                    member: member_pda,
                    vault: vault_pda,
                    member_token_account: env.member_atas[i],
                    system_program: system_program::ID,
                    token_program: token::ID,
                }
                .to_account_metas(None),
                data: instruction::JoinCircle.data(),
            };
            let blockhash = env.svm.latest_blockhash();
            let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
            env.svm.send_transaction(tx).unwrap();
        }

        // Member 0 contributes on time
        let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
        let contribute_ix0 = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::Contribute {
                member_wallet: env.members[0].pubkey(),
                circle: circle_pda,
                member: member0_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[0],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix0], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
        env.svm.send_transaction(tx).unwrap();

        // Advance clock past 1 week (into grace period: + frequency + 10 hours)
        let mut clock = env.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += frequency + 36_000;
        env.svm.set_sysvar::<Clock>(&clock);

        // Member 1 triggers handle_late_payment (any circle member may start a peer's grace period)
        let (member1_pda, _) = get_member_pda(&circle_pda, &env.members[1].pubkey());
        let late_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::HandleLatePayment {
                caller: env.members[1].pubkey(),
                caller_member: member1_pda,
                circle: circle_pda,
                member: member1_pda,
            }
            .to_account_metas(None),
            data: instruction::HandleLatePayment.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[late_ix], Some(&env.members[1].pubkey()), &[&env.members[1]], blockhash);
        env.svm.send_transaction(tx).expect("Handle late payment should start grace period");

        // Member 1 now pays late with 7% fee (107 USDC)
        let bal1_before = get_token_balance(&env.svm, &env.member_atas[1]);
        let contribute_late_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::Contribute {
                member_wallet: env.members[1].pubkey(),
                circle: circle_pda,
                member: member1_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[1],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_late_ix], Some(&env.members[1].pubkey()), &[&env.members[1]], blockhash);
        env.svm.send_transaction(tx).expect("Late contribution with fee should succeed");

        let bal1_after = get_token_balance(&env.svm, &env.member_atas[1]);
        // Deducted exactly 100 USDC + 7% fee = 107 USDC
        assert_eq!(bal1_before - bal1_after, 107 * ONE_USDC);
    }

    #[test]
    fn test_cancel_circle_before_circle_fills() {
        let contribution_amount = 50 * ONE_USDC;
        let frequency = 604_800;
        let max_members = 3u8;
        let circle_id = 4u64;

        let mut env = setup_env(2, 500 * ONE_USDC);
        let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
        let (vault_pda, _) = get_vault_pda(&circle_pda);

        // 1. Create Circle
        let create_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::CreateCircle {
                creator: env.creator.pubkey(),
                circle: circle_pda,
                vault: vault_pda,
                usdc_mint: env.usdc_mint,
                system_program: system_program::ID,
                token_program: token::ID,
                rent: anchor_lang::prelude::Rent::id(),
            }
            .to_account_metas(None),
            data: instruction::CreateCircle {
                circle_id,
                contribution_amount,
                frequency,
                max_members,
                payout_order: vec![],
            }
            .data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
        env.svm.send_transaction(tx).unwrap();

        // 2. Only 1 member joins
        let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::JoinCircle {
                member_wallet: env.members[0].pubkey(),
                circle: circle_pda,
                member: member0_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[0],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
        env.svm.send_transaction(tx).unwrap();

        // 3. Creator cancels circle
        let cancel_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::CancelCircle {
                creator: env.creator.pubkey(),
                circle: circle_pda,
            }
            .to_account_metas(None),
            data: instruction::CancelCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[cancel_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
        env.svm.send_transaction(tx).expect("Creator should be able to cancel forming circle");

        let circle_acc = env.svm.get_account(&circle_pda).unwrap();
        let circle_state: Circle = Circle::try_deserialize(&mut circle_acc.data.as_slice()).unwrap();
        assert_eq!(circle_state.status, CircleStatus::Cancelled);

        // 4. Joined member reclaims locked stake
        let bal0_before = get_token_balance(&env.svm, &env.member_atas[0]);
        let refund_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::RefundCancelledStake {
                member_wallet: env.members[0].pubkey(),
                circle: circle_pda,
                member: member0_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[0],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::RefundCancelledStake.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[refund_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
        env.svm.send_transaction(tx).expect("Joined member should be refunded locked stake");

        let bal0_after = get_token_balance(&env.svm, &env.member_atas[0]);
        assert_eq!(bal0_after - bal0_before, 50 * ONE_USDC);
assert_eq!(get_token_balance(&env.svm, &vault_pda), 0);
    }

    #[test]
    fn test_release_payout_before_deadline_fails() {
    let contribution_amount = 50 * ONE_USDC;
    let frequency = 604_800; // 1 week
    let max_members = 3u8;
    let circle_id = 10u64;

    let mut env = setup_env(3, 500 * ONE_USDC);
    let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
    let (vault_pda, _) = get_vault_pda(&circle_pda);

    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::CreateCircle {
            creator: env.creator.pubkey(),
            circle: circle_pda,
            vault: vault_pda,
            usdc_mint: env.usdc_mint,
            system_program: system_program::ID,
            token_program: token::ID,
            rent: anchor_lang::prelude::Rent::id(),
        }
        .to_account_metas(None),
        data: instruction::CreateCircle {
            circle_id,
            contribution_amount,
            frequency,
            max_members,
            payout_order: vec![],
        }
        .data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
    env.svm.send_transaction(tx).unwrap();

    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::JoinCircle {
                member_wallet: env.members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[i],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
        let contribute_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::Contribute {
                member_wallet: env.members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
    let release_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::ReleasePayout {
            caller: env.members[0].pubkey(),
            circle: circle_pda,
            recipient_member: member0_pda,
            vault: vault_pda,
            recipient_token_account: env.member_atas[0],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::ReleasePayout.data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[release_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
    let result = env.svm.send_transaction(tx);
    assert!(result.is_err(), "release_payout before deadline must be rejected");
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("RoundDeadlineNotReached"),
        "expected RoundDeadlineNotReached, got: {}",
        err_msg
    );
}

#[test]
fn test_release_payout_before_pot_complete_fails() {
    let contribution_amount = 50 * ONE_USDC;
    let frequency = 604_800;
    let max_members = 3u8;
    let circle_id = 11u64;

    let mut env = setup_env(3, 500 * ONE_USDC);
    let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
    let (vault_pda, _) = get_vault_pda(&circle_pda);

    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::CreateCircle {
            creator: env.creator.pubkey(),
            circle: circle_pda,
            vault: vault_pda,
            usdc_mint: env.usdc_mint,
            system_program: system_program::ID,
            token_program: token::ID,
            rent: anchor_lang::prelude::Rent::id(),
        }
        .to_account_metas(None),
        data: instruction::CreateCircle {
            circle_id,
            contribution_amount,
            frequency,
            max_members,
            payout_order: vec![],
        }
        .data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
    env.svm.send_transaction(tx).unwrap();

    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::JoinCircle {
                member_wallet: env.members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[i],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
    let contribute_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::Contribute {
            member_wallet: env.members[0].pubkey(),
            circle: circle_pda,
            member: member0_pda,
            vault: vault_pda,
            member_token_account: env.member_atas[0],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::Contribute.data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
    env.svm.send_transaction(tx).unwrap();

    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += frequency;
    env.svm.set_sysvar::<Clock>(&clock);

    let release_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::ReleasePayout {
            caller: env.members[0].pubkey(),
            circle: circle_pda,
            recipient_member: member0_pda,
            vault: vault_pda,
            recipient_token_account: env.member_atas[0],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::ReleasePayout.data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[release_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
    let result = env.svm.send_transaction(tx);
    assert!(result.is_err(), "release_payout with incomplete pot must be rejected");
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("RoundPotIncomplete"),
        "expected RoundPotIncomplete, got: {}",
        err_msg
    );
}

#[test]
fn test_handle_late_payment_unauthorized_caller_fails() {
    let contribution_amount = 50 * ONE_USDC;
    let frequency = 604_800;
    let max_members = 2u8;
    let circle_id = 12u64;

    let mut env = setup_env(3, 500 * ONE_USDC);
    let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
    let (vault_pda, _) = get_vault_pda(&circle_pda);

    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::CreateCircle {
            creator: env.creator.pubkey(),
            circle: circle_pda,
            vault: vault_pda,
            usdc_mint: env.usdc_mint,
            system_program: system_program::ID,
            token_program: token::ID,
            rent: anchor_lang::prelude::Rent::id(),
        }
        .to_account_metas(None),
        data: instruction::CreateCircle {
            circle_id,
            contribution_amount,
            frequency,
            max_members,
            payout_order: vec![],
        }
        .data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
    env.svm.send_transaction(tx).unwrap();

    for i in 0..2 {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::JoinCircle {
                member_wallet: env.members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[i],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
    let contribute_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::Contribute {
            member_wallet: env.members[0].pubkey(),
            circle: circle_pda,
            member: member0_pda,
            vault: vault_pda,
            member_token_account: env.member_atas[0],
            token_program: token::ID,
        }
        .to_account_metas(None),
        data: instruction::Contribute.data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
    env.svm.send_transaction(tx).unwrap();

    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += frequency;
    env.svm.set_sysvar::<Clock>(&clock);

    // An unrelated third party (no Member account for this circle) tries to start
// Member 1's grace period. The caller_member PDA is derived from the intruder's
// pubkey, does not exist, and the transaction is rejected.
let intruder = Keypair::new();
env.svm.airdrop(&intruder.pubkey(), 1_000_000_000).unwrap();

let (member1_pda, _) = get_member_pda(&circle_pda, &env.members[1].pubkey());
let (intruder_member_pda, _) = get_member_pda(&circle_pda, &intruder.pubkey());
let late_ix = Instruction {
    program_id: PROGRAM_ID,
    accounts: crate::accounts::HandleLatePayment {
        caller: intruder.pubkey(),
        caller_member: intruder_member_pda,
        circle: circle_pda,
        member: member1_pda,
    }
    .to_account_metas(None),
    data: instruction::HandleLatePayment.data(),
};
let blockhash = env.svm.latest_blockhash();
let tx = Transaction::new_signed_with_payer(&[late_ix], Some(&intruder.pubkey()), &[&intruder], blockhash);
let result = env.svm.send_transaction(tx);
assert!(result.is_err(), "handle_late_payment by non-member must be rejected");
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("AccountNotInitialized") || err_msg.contains("AccountNotFound") || err_msg.contains("Unauthorized"),
        "expected account-validation rejection, got: {}",
        err_msg
    );
}

#[test]
fn test_process_default_unauthorized_caller_fails() {
    let contribution_amount = 50 * ONE_USDC;
    let frequency = 604_800;
    let max_members = 3u8;
    let circle_id = 13u64;

    let mut env = setup_env(3, 500 * ONE_USDC);
    let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
    let (vault_pda, _) = get_vault_pda(&circle_pda);

    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::CreateCircle {
            creator: env.creator.pubkey(),
            circle: circle_pda,
            vault: vault_pda,
            usdc_mint: env.usdc_mint,
            system_program: system_program::ID,
            token_program: token::ID,
            rent: anchor_lang::prelude::Rent::id(),
        }
        .to_account_metas(None),
        data: instruction::CreateCircle {
            circle_id,
            contribution_amount,
            frequency,
            max_members,
            payout_order: vec![],
        }
        .data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
    env.svm.send_transaction(tx).unwrap();

    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::JoinCircle {
                member_wallet: env.members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[i],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    for i in &[0, 2] {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[*i].pubkey());
        let contribute_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::Contribute {
                member_wallet: env.members[*i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[*i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[*i].pubkey()), &[&env.members[*i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += frequency + 216_000 + 1000;
    env.svm.set_sysvar::<Clock>(&clock);

    let intruder = Keypair::new();
    env.svm.airdrop(&intruder.pubkey(), 1_000_000_000).unwrap();

    let (member1_pda, _) = get_member_pda(&circle_pda, &env.members[1].pubkey());
    let (intruder_member_pda, _) = get_member_pda(&circle_pda, &intruder.pubkey());
    let default_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::ProcessDefault {
            caller: intruder.pubkey(),
            caller_member: intruder_member_pda,
            circle: circle_pda,
            member: member1_pda,
        }
        .to_account_metas(None),
        data: instruction::ProcessDefault.data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[default_ix], Some(&intruder.pubkey()), &[&intruder], blockhash);
    let result = env.svm.send_transaction(tx);
    assert!(result.is_err(), "process_default by non-member must be rejected");
    let err_msg = format!("{:?}", result.unwrap_err());
    assert!(
        err_msg.contains("AccountNotInitialized") || err_msg.contains("AccountNotFound") || err_msg.contains("Unauthorized"),
        "expected account-validation rejection, got: {}",
        err_msg
    );
}

#[test]
fn test_process_default_callable_by_peer_member() {
    let contribution_amount = 50 * ONE_USDC;
    let frequency = 604_800;
    let max_members = 3u8;
    let circle_id = 14u64;

    let mut env = setup_env(3, 500 * ONE_USDC);
    let (circle_pda, _) = get_circle_pda(&env.creator.pubkey(), circle_id);
    let (vault_pda, _) = get_vault_pda(&circle_pda);

    // 1. Create Circle
    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::CreateCircle {
            creator: env.creator.pubkey(),
            circle: circle_pda,
            vault: vault_pda,
            usdc_mint: env.usdc_mint,
            system_program: system_program::ID,
            token_program: token::ID,
            rent: anchor_lang::prelude::Rent::id(),
        }
        .to_account_metas(None),
        data: instruction::CreateCircle {
            circle_id,
            contribution_amount,
            frequency,
            max_members,
            payout_order: vec![],
        }
        .data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[create_ix], Some(&env.creator.pubkey()), &[&env.creator], blockhash);
    env.svm.send_transaction(tx).unwrap();

    // 2. All 3 members join
    for i in 0..3 {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[i].pubkey());
        let join_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::JoinCircle {
                member_wallet: env.members[i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[i],
                system_program: system_program::ID,
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::JoinCircle.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[join_ix], Some(&env.members[i].pubkey()), &[&env.members[i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    // 3. Members 0 and 2 contribute; Member 1 misses the deadline
    for i in &[0, 2] {
        let (member_pda, _) = get_member_pda(&circle_pda, &env.members[*i].pubkey());
        let contribute_ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: crate::accounts::Contribute {
                member_wallet: env.members[*i].pubkey(),
                circle: circle_pda,
                member: member_pda,
                vault: vault_pda,
                member_token_account: env.member_atas[*i],
                token_program: token::ID,
            }
            .to_account_metas(None),
            data: instruction::Contribute.data(),
        };
        let blockhash = env.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(&[contribute_ix], Some(&env.members[*i].pubkey()), &[&env.members[*i]], blockhash);
        env.svm.send_transaction(tx).unwrap();
    }

    // 4. Advance clock past deadline + grace period
    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += frequency + 216_000 + 1000;
    env.svm.set_sysvar::<Clock>(&clock);

    // 5. Member 0 (a peer, not the defaulting member) triggers process_default on Member 1.
    //    This must succeed — any circle member may initiate a default, so a
    //    non-cooperative defaulting member cannot stall the round indefinitely.
    let (member0_pda, _) = get_member_pda(&circle_pda, &env.members[0].pubkey());
    let (member1_pda, _) = get_member_pda(&circle_pda, &env.members[1].pubkey());
    let default_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: crate::accounts::ProcessDefault {
            caller: env.members[0].pubkey(),
            caller_member: member0_pda,
            circle: circle_pda,
            member: member1_pda,
        }
        .to_account_metas(None),
        data: instruction::ProcessDefault.data(),
    };
    let blockhash = env.svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(&[default_ix], Some(&env.members[0].pubkey()), &[&env.members[0]], blockhash);
    env.svm.send_transaction(tx).expect("Peer member should be able to trigger process_default");

    let member1_acc = env.svm.get_account(&member1_pda).unwrap();
    let member1_state: Member = Member::try_deserialize(&mut member1_acc.data.as_slice()).unwrap();
    assert!(member1_state.has_defaulted, "Member 1 should be marked defaulted");
    assert_eq!(member1_state.stake_amount, 0);
}
}
